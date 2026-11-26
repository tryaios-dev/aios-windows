"""The local model (G-02): chat answers and the engine endpoints over the process manager.

``LocalModels`` is both the chat app's ``AnswerSource`` and the models app's ``LocalEngine``.
It answers with the installed model (the one asked for; when none is asked for, the default model,
else the first installed one), started on demand by ``EngineManager``. One model is loaded at a time.

Chat produces answers in a worker thread, the process manager lives on the event loop: every
call into the manager is handed to the loop (``bind`` gives it at start-up). A lease is held for
the whole answer, so the engine is never unloaded mid-answer. If the GPU build dies before the
first words, the same request goes once more to the CPU build (D-06).

It answers for the ``local`` provider only; the company's server is ``aios_backend.company`` (G-06).
"""

import asyncio
import hashlib
from collections.abc import Coroutine, Iterator
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select

from aios_backend.apps.chat.answers import ModelInfo
from aios_backend.apps.models.engine import (
    BenchmarkRun,
    EngineBusy,
    EngineState,
    Fallback,
    GpuDevice,
)
from aios_backend.apps.models.models import InstalledModel
from aios_backend.components import Components, ComponentState
from aios_backend.engine import EngineBusy as ManagerBusy
from aios_backend.engine import EngineManager, NoModel
from aios_backend.engine import client as engine_client
from aios_backend.engine.launcher import CONTEXT_TOKENS, EngineError
from aios_backend.prompting import with_system_prompt
from db.base import utcnow
from db.lookups import default_model_id
from db.session import Database

MIB = 1024**2
WAIT_S = 300.0  # starting a large model from a slow disk
COUNTS_KEPT = 4096  # token counts remembered per text digest (no text is kept)
# Sent before every local conversation (the chat app reserves room for it: SYSTEM_PROMPT_TOKENS).
# Without it, small models answer every later message with their self-introduction.
SYSTEM_PROMPT = (
    "You are the AIOS assistant, running privately on this computer. Answer the user's latest "
    "message directly and helpfully. Do not introduce yourself unless asked who you are."
)
STATES = {
    ComponentState.NOT_STARTED: "not_started",
    ComponentState.STARTING: "loading",
    ComponentState.OK: "ready",
    ComponentState.DEGRADED: "ready",
    ComponentState.FAILED: "failed",
}


@dataclass(frozen=True)
class _Model:
    id: str
    path: Path
    context_length: int


class LocalModels:
    def __init__(self, db: Database, manager: EngineManager, components: Components) -> None:
        self._db = db
        self._manager = manager
        self._c = components
        self._loop: asyncio.AbstractEventLoop | None = None
        self._fallback_at: datetime | None = None
        self._fallback_seen = False
        self._counts: dict[tuple[str, bytes], int] = {}

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    # ---- which model ----------------------------------------------------------------------

    def _installed(self, model_id: str | None) -> _Model | None:
        """The model asked for; without one, the default model, else the first installed one.
        A model asked for that is no longer installed is None, never another model: the person
        chooses which one carries on (I-04, K-06)."""
        with self._db.session() as session:
            row = None
            if model_id is not None:
                row = session.get(InstalledModel, model_id)
                if row is None:
                    return None
            if row is None:
                default = default_model_id(session)
                row = session.get(InstalledModel, default) if default else None
            if row is None:
                row = session.scalars(
                    select(InstalledModel).order_by(InstalledModel.installed_at)
                ).first()
            if row is None or not Path(row.file_path).is_file():
                return None
            return _Model(row.id, Path(row.file_path), row.context_length)

    def default_path(self) -> Path | None:
        """For the process manager: the model to load when nothing else is asked for."""
        model = self._installed(None)
        return model.path if model else None

    # ---- AnswerSource ---------------------------------------------------------------------

    def model(self, provider: str, model_id: str | None) -> ModelInfo | None:
        if provider != "local":
            return None
        model = self._installed(model_id)
        if model is None:
            return None
        return ModelInfo(
            model_id=model.id,
            context_length=min(model.context_length, CONTEXT_TOKENS),
            runtime="llama-server",
        )

    def prepare(self, provider: str, messages: list[dict[str, str]]) -> list[dict[str, str]]:
        """The messages exactly as they go to the engine: the AIOS prompt first, once. Chat calls
        this before the input commitment, so evidence covers the bytes sent (G-03)."""
        return with_system_prompt(SYSTEM_PROMPT, messages)

    def answer(
        self, provider: str, model_id: str, messages: list[dict[str, str]]
    ) -> engine_client.Streamed:
        out = engine_client.Streamed()
        out._chunks = self._answer(provider, model_id, self.prepare(provider, messages), out)
        return out

    def _answer(
        self,
        provider: str,
        model_id: str,
        messages: list[dict[str, str]],
        out: engine_client.Streamed,
    ) -> Iterator[str]:
        model = self._installed(model_id)
        if provider != "local" or model is None:
            raise NoModel
        for attempt in (1, 2):
            engine = self._call(self._manager.acquire(model.path))
            sent = False
            try:
                stream = engine_client.stream_chat(engine, messages)
                for chunk in stream:
                    sent = True
                    yield chunk
                out.usage = stream.usage
                return
            except Exception:
                lost = attempt == 1 and not sent and self._call(self._manager.lost_gpu(engine))
                if not lost:
                    raise
            finally:
                self._release()
        raise EngineError("engine_failed")

    def count_tokens(self, provider: str, model_id: str, text: str) -> int | None:
        """Tokens as the model counts them, from the engine's tokenizer (G-04). None unless the
        engine already has this model loaded: counting never starts or switches the engine."""
        model = self._installed(model_id) if provider == "local" and self._loop else None
        if model is None:
            return None
        key = (model.id, hashlib.sha256(text.encode("utf-8")).digest())
        if key in self._counts:
            return self._counts[key]
        engine = self._call(self._manager.lease_if_loaded(model.path))
        if engine is None:
            return None
        try:
            n = engine_client.count_tokens(engine, text)
        except Exception:
            return None
        finally:
            self._release()
        if len(self._counts) >= COUNTS_KEPT:
            self._counts.clear()
        self._counts[key] = n
        return n

    # ---- LocalEngine ----------------------------------------------------------------------

    def state(self) -> EngineState:
        if self._c.engine_cpu_fallback and not self._fallback_seen:
            self._fallback_seen, self._fallback_at = True, utcnow()
        fallback = (
            Fallback(self._fallback_at, "vulkan", "cpu", acknowledged=False)
            if self._fallback_at is not None
            else None
        )
        state = "idle_unloaded" if self._c.engine_idle_unloaded else STATES[self._c.engine]
        loaded = None
        if self._c.engine_model:
            with self._db.session() as session:
                loaded = next(
                    (
                        m.id
                        for m in session.scalars(select(InstalledModel))
                        if Path(m.file_path).name == self._c.engine_model
                    ),
                    None,
                )
        return EngineState(
            state=state,
            build=self._c.engine_build or "cpu",
            loaded_model_id=loaded,
            fallback=fallback,
        )

    def start(self, model_id: str, model_path: str, cpu_only: bool) -> EngineState:
        self._call(self._manager.set_safe_mode(cpu_only))
        try:  # the person waits on this: say "busy" at once rather than wait for the answer
            self._call(self._manager.ensure(Path(model_path), wait_s=0))
        except ManagerBusy:
            raise EngineBusy from None
        return self.state()

    def benchmark(self, model_id: str, model_path: str, cpu_only: bool) -> BenchmarkRun:
        self._call(self._manager.set_safe_mode(cpu_only))
        try:
            engine = self._call(self._manager.acquire(Path(model_path), wait_s=0))
        except ManagerBusy:
            raise EngineBusy from None
        try:
            run = engine_client.benchmark(engine)
        finally:
            self._release()
        return BenchmarkRun(run.tokens_per_second, run.time_to_first_token_ms, engine.build)

    def unload(self, model_path: str) -> None:
        if self._loop is None:  # the engine never ran in this process
            return
        try:
            self._call(self._manager.unload(Path(model_path)))
        except ManagerBusy:
            raise EngineBusy from None

    def acknowledge_fallback(self) -> None:
        self._fallback_at = None

    def devices(self) -> list[GpuDevice] | None:
        if self._loop is None:
            return None
        found = self._call(self._manager.devices())
        if found is None:
            return None
        return [GpuDevice(d.total_mib * MIB, d.free_mib * MIB, d.integrated) for d in found]

    # ---- the event loop -------------------------------------------------------------------

    def _call[T](self, coro: Coroutine[Any, Any, T]) -> T:
        if self._loop is None:
            coro.close()
            raise EngineError("engine_not_ready")
        return asyncio.run_coroutine_threadsafe(coro, self._loop).result(WAIT_S)

    def _release(self) -> None:
        if self._loop is not None:
            self._loop.call_soon_threadsafe(self._manager.release)
