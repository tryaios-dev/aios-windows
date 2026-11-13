"""The local model (G-02): chat answers and the engine endpoints over the process manager.

``LocalModels`` is both the chat app's ``AnswerSource`` and the models app's ``LocalEngine``.
It answers with the installed model (the one asked for, else the default model, else the first
installed one), started on demand by ``EngineManager``. One model is loaded at a time.

Chat produces answers in a worker thread, the process manager lives on the event loop: every
call into the manager is handed to the loop (``bind`` gives it at start-up). A lease is held for
the whole answer, so the engine is never unloaded mid-answer. If the GPU build dies before the
first words, the same request goes once more to the CPU build (D-06).

The Company provider is not built yet (G-06), so ``model("company", …)`` is None and chat answers
``company_unreachable``.
"""

import asyncio
from collections.abc import Coroutine, Iterator
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select

from aios_backend.apps.chat.answers import ModelInfo
from aios_backend.apps.models.engine import BenchmarkRun, EngineState, Fallback
from aios_backend.apps.models.models import InstalledModel
from aios_backend.components import Components, ComponentState
from aios_backend.engine import EngineManager, NoModel
from aios_backend.engine import client as engine_client
from aios_backend.engine.launcher import CONTEXT_TOKENS, EngineError
from db.base import utcnow
from db.lookups import default_model_id
from db.session import Database

WAIT_S = 300.0  # starting a large model from a slow disk
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

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    # ---- which model ----------------------------------------------------------------------

    def _installed(self, model_id: str | None) -> _Model | None:
        with self._db.session() as session:
            row = None
            if model_id is not None:
                row = session.get(InstalledModel, model_id)
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

    def answer(self, provider: str, model_id: str, messages: list[dict[str, str]]) -> Iterator[str]:
        model = self._installed(model_id)
        if provider != "local" or model is None:
            raise NoModel
        if not messages or messages[0].get("role") != "system":
            messages = [{"role": "system", "content": SYSTEM_PROMPT}, *messages]
        for attempt in (1, 2):
            engine = self._call(self._manager.acquire(model.path))
            sent = False
            try:
                for chunk in engine_client.stream_chat(engine, messages):
                    sent = True
                    yield chunk
                return
            except Exception:
                lost = attempt == 1 and not sent and self._call(self._manager.lost_gpu(engine))
                if not lost:
                    raise
            finally:
                self._release()
        raise EngineError("engine_failed")

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
        self._call(self._manager.ensure(Path(model_path)))
        return self.state()

    def benchmark(self, model_id: str, model_path: str, cpu_only: bool) -> BenchmarkRun:
        self._call(self._manager.set_safe_mode(cpu_only))
        engine = self._call(self._manager.acquire(Path(model_path)))
        try:
            run = engine_client.benchmark(engine)
        finally:
            self._release()
        return BenchmarkRun(run.tokens_per_second, run.time_to_first_token_ms, engine.build)

    def acknowledge_fallback(self) -> None:
        self._fallback_at = None

    # ---- the event loop -------------------------------------------------------------------

    def _call[T](self, coro: Coroutine[Any, Any, T]) -> T:
        if self._loop is None:
            coro.close()
            raise EngineError("engine_not_ready")
        return asyncio.run_coroutine_threadsafe(coro, self._loop).result(WAIT_S)

    def _release(self) -> None:
        if self._loop is not None:
            self._loop.call_soon_threadsafe(self._manager.release)
