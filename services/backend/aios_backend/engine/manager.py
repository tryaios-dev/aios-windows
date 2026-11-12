"""Process manager for llama-server (MVP 5.1, 11.1; Master FR-38; contract IPC-30 to IPC-52).

* Starts the engine only when a local conversation needs it (``use()``), on the Vulkan build
  when it finds a GPU, otherwise on the CPU build.
* "Safe mode (CPU)" (D-06, saved in chats.db by ``apps/settings``): while it is on the Vulkan
  binary is never started, not even to probe for a GPU. Turning it on stops a running GPU
  engine as soon as no answer is using it.
* If the GPU build fails to start or crashes, it switches to the CPU build for the rest of the
  session, restarts at once and reports ``engine_cpu_fallback`` on ``/health`` (MVP 4.3). A
  caller whose request died with the GPU engine (``lost_gpu()``) retries it once, so the user
  still gets that answer from the CPU build.
* A watcher checks every second that the engine is still running and unloads it after an
  idle period; the next request starts it again.
* Every engine runs in the backend's kill-on-close Job Object (IPC-50); orphans from a crash
  are ended at start-up (IPC-52).
"""

import asyncio
import contextlib
import time
from collections.abc import AsyncIterator, Callable
from enum import StrEnum
from pathlib import Path

from aios_backend.components import Components, ComponentState
from aios_backend.engine.job import ChildJob, kill_on_close_job
from aios_backend.engine.launcher import (
    EXE,
    Engine,
    EngineError,
    find_model,
    list_gpus,
    start,
)
from aios_backend.engine.orphans import kill_orphans
from aios_common.logging import get_logger, log_event

IDLE_UNLOAD_S = 300.0  # 5 minutes without a request
WATCH_INTERVAL_S = 1.0

log = get_logger("engine")


class Build(StrEnum):
    CPU = "cpu"
    VULKAN = "vulkan"


class NoModel(Exception):
    """No model in the models folder."""


StartFn = Callable[[Path, Path, Path, ChildJob, str], Engine]
ProbeFn = Callable[[Path, Path], list[str]]


class EngineManager:
    def __init__(
        self,
        engine_root: Path,
        models_dir: Path,
        temp_dir: Path,
        components: Components,
        *,
        idle_unload_s: float = IDLE_UNLOAD_S,
        safe_mode: bool = False,
        watch_interval_s: float = WATCH_INTERVAL_S,
        start_fn: StartFn = start,
        probe_fn: ProbeFn = list_gpus,
    ) -> None:
        self._root = engine_root  # holds cpu/ and vulkan/
        self._models_dir = models_dir
        self._temp_dir = temp_dir
        self._c = components
        self._idle_unload_s = idle_unload_s
        self._safe_mode = safe_mode
        self._watch_interval_s = watch_interval_s
        self._start_fn = start_fn
        self._probe_fn = probe_fn

        self._engine: Engine | None = None
        self._lock = asyncio.Lock()
        self._job = kill_on_close_job()
        self._leases = 0
        self._last_used = 0.0
        self._has_gpu: bool | None = None  # probed once, on the first start
        self._cpu_fallback = False
        self._watcher: asyncio.Task[None] | None = None

    # ---- lifetime -------------------------------------------------------------------------

    async def startup(self) -> None:
        await asyncio.to_thread(kill_orphans, self._root)
        self._watcher = asyncio.create_task(self._watch())

    async def shutdown(self) -> None:
        if self._watcher is not None:
            self._watcher.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._watcher
            self._watcher = None
        engine, self._engine = self._engine, None
        if engine is not None:
            await asyncio.to_thread(engine.stop)
        self._set(ComponentState.NOT_STARTED)
        self._job.close()

    @property
    def job(self) -> ChildJob:
        """The backend's kill-on-close job (IPC-50); the evidence writer joins it too."""
        return self._job

    @property
    def safe_mode(self) -> bool:
        return self._safe_mode

    async def set_safe_mode(self, on: bool) -> None:
        async with self._lock:
            if on != self._safe_mode:
                log_event(log, "engine_safe_mode", status="on" if on else "off")
            self._safe_mode = on
            await self._leave_gpu_if_safe_mode()

    # ---- use ------------------------------------------------------------------------------

    @contextlib.asynccontextmanager
    async def use(self) -> AsyncIterator[Engine]:
        """The running engine, started if needed. Not unloaded while in use."""
        engine = await self.ensure()
        self._leases += 1
        try:
            yield engine
        finally:
            self._leases -= 1
            self._last_used = time.monotonic()

    async def ensure(self) -> Engine:
        """Start the engine if it is not running. Raises ``NoModel`` or ``EngineError``."""
        async with self._lock:
            self._last_used = time.monotonic()
            self._reap()
            if self._engine is not None:
                return self._engine
            return await self._start()

    async def lost_gpu(self, engine: Engine, wait_s: float = 3.0) -> bool:
        """True if ``engine`` is the GPU build and has exited (a request to it just failed).
        The caller may then retry once: the next ``use()`` runs on the CPU build."""
        if engine.build != Build.VULKAN:
            return False
        deadline = time.monotonic() + wait_s
        while engine.alive() and time.monotonic() < deadline:
            await asyncio.sleep(0.05)
        return not engine.alive()

    # ---- internals (called with the lock held) --------------------------------------------

    async def _start(self) -> Engine:
        model = find_model(self._models_dir)
        if model is None:
            raise NoModel
        build = await self._pick_build()
        self._set(ComponentState.STARTING, build, model)
        try:
            engine = await asyncio.to_thread(
                self._start_fn, self._root / build, model, self._temp_dir, self._job, build.value
            )
        except EngineError as exc:
            if build is Build.CPU:
                self._set(ComponentState.FAILED)
                raise
            self._fall_back(str(exc))
            return await self._start()
        self._engine = engine
        self._last_used = time.monotonic()
        self._set(ComponentState.OK, build, model)
        return engine

    async def _pick_build(self) -> Build:
        if self._safe_mode or self._cpu_fallback:
            return Build.CPU
        if self._has_gpu is None:
            gpu_dir = self._root / Build.VULKAN
            self._has_gpu = (gpu_dir / EXE).is_file() and bool(
                await asyncio.to_thread(self._probe_fn, gpu_dir, self._temp_dir)
            )
        return Build.VULKAN if self._has_gpu else Build.CPU

    def _reap(self) -> Build | None:
        """If the engine exited on its own, forget it. Returns the build that crashed."""
        engine = self._engine
        if engine is None or engine.alive():
            return None
        self._engine = None
        log_event(
            log,
            "engine_exited",
            component=engine.build,
            error_code=str(engine.process.returncode),
        )
        crashed = Build(engine.build)
        if crashed is Build.VULKAN:
            self._fall_back("engine_crashed")
        self._set(ComponentState.FAILED)
        return crashed

    async def _leave_gpu_if_safe_mode(self) -> None:
        engine = self._engine
        if not self._safe_mode or engine is None or engine.build != Build.VULKAN or self._leases:
            return
        self._engine = None
        await asyncio.to_thread(engine.stop)
        self._set(ComponentState.NOT_STARTED)

    def _fall_back(self, reason: str) -> None:
        self._cpu_fallback = True
        self._c.engine_cpu_fallback = True
        log_event(log, "engine_gpu_fallback", error_code=reason)

    def _set(
        self, state: ComponentState, build: Build | None = None, model: Path | None = None
    ) -> None:
        self._c.engine = state
        self._c.engine_build = build.value if build else None
        self._c.engine_model = model.name if model else None
        if state is not ComponentState.NOT_STARTED:
            self._c.engine_idle_unloaded = False

    # ---- watcher --------------------------------------------------------------------------

    async def _watch(self) -> None:
        while True:
            await asyncio.sleep(self._watch_interval_s)
            if self._lock.locked():  # a start or stop is in progress
                continue
            try:
                async with self._lock:
                    await self._check()
            except Exception as exc:  # the watcher must survive anything
                log_event(log, "engine_watch_error", error_code=type(exc).__name__)

    async def _check(self) -> None:
        if self._reap() is Build.VULKAN:
            # MVP 4.3: a GPU crash restarts the engine on the CPU build at once.
            with contextlib.suppress(NoModel, EngineError):
                await self._start()
            return
        await self._leave_gpu_if_safe_mode()  # safe mode turned on during an answer
        engine = self._engine
        if engine is None or self._leases:
            return
        if time.monotonic() - self._last_used >= self._idle_unload_s:
            self._engine = None
            await asyncio.to_thread(engine.stop)
            self._set(ComponentState.NOT_STARTED)
            self._c.engine_idle_unloaded = True
            log_event(log, "engine_idle_unloaded", component=engine.build)
