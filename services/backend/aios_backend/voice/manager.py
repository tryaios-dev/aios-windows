"""Process manager for whisper-server (ADR 0016; contract IPC-35 to IPC-38), modelled on the
chat engine's (``aios_backend.engine.manager``) and simpler:

* Started when someone starts speaking (``ensure()``), with the one voice model.
* The Vulkan build when the chat engine found a GPU and Safe mode is off, else the CPU build. If
  the GPU build fails to start or crashes, the CPU build is used for the rest of the session.
* Stopped after an idle period; the next dictation starts it again (about a second).
* Runs in the backend's kill-on-close Job Object (IPC-50); orphans from a crash are ended at
  start-up (IPC-52).
"""

import asyncio
import contextlib
import hashlib
import time
from collections.abc import Callable
from enum import StrEnum
from pathlib import Path

from aios_backend.engine.job import ChildJob
from aios_backend.engine.orphans import kill_orphans
from aios_backend.voice.launcher import EXE, VoiceError, Whisper, start
from aios_common.logging import get_logger, log_event

# Whisper small, multilingual, q5_1 (MIT): the model ADR 0016 chose. Only this exact file is
# loaded. It is put in the models folder by the installer, or by hand.
MODEL_FILE = "ggml-small-q5_1.bin"
MODEL_SHA256 = "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb"
IDLE_UNLOAD_S = 300.0
WATCH_INTERVAL_S = 5.0

log = get_logger("voice")


class VoiceState(StrEnum):
    NOT_BUILT = "not_built"  # no whisper-server next to the backend
    NO_MODEL = "no_model"  # the model file is missing or not the expected one
    NOT_STARTED = "not_started"
    STARTING = "starting"
    READY = "ready"
    FAILED = "failed"


StartFn = Callable[[Path, Path, Path, ChildJob, str], Whisper]


class VoiceManager:
    def __init__(
        self,
        voice_root: Path,
        models_dir: Path,
        temp_dir: Path,
        job: Callable[[], ChildJob],
        *,
        prefer_gpu: Callable[[], bool] = lambda: False,
        idle_unload_s: float = IDLE_UNLOAD_S,
        watch_interval_s: float = WATCH_INTERVAL_S,
        start_fn: StartFn = start,
        model_sha256: str = MODEL_SHA256,
    ) -> None:
        self._root = voice_root  # holds cpu/ and vulkan/
        self._models_dir = models_dir
        self._temp_dir = temp_dir
        self._job = job  # the engine manager's job, shared (IPC-50)
        self._prefer_gpu = prefer_gpu
        self._idle_unload_s = idle_unload_s
        self._watch_interval_s = watch_interval_s
        self._start_fn = start_fn
        self._model_sha256 = model_sha256

        self._whisper: Whisper | None = None
        self._lock = asyncio.Lock()
        self._state = VoiceState.NOT_STARTED
        self._failed = False
        self._cpu_fallback = False
        self._last_used = 0.0
        self._verified: tuple[int, float] | None = None  # (size, mtime) of the checked model
        self._watcher: asyncio.Task[None] | None = None

    # ---- lifetime -------------------------------------------------------------------------

    async def startup(self) -> None:
        await asyncio.to_thread(kill_orphans, self._root, None, 10.0, EXE)
        self._watcher = asyncio.create_task(self._watch())

    async def shutdown(self) -> None:
        if self._watcher is not None:
            self._watcher.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._watcher
            self._watcher = None
        await self._stop()

    # ---- state ----------------------------------------------------------------------------

    @property
    def model_path(self) -> Path:
        return self._models_dir / MODEL_FILE

    def state(self) -> tuple[VoiceState, str | None]:
        """What GET /voice/status reports: the state, and the build while running."""
        whisper = self._whisper
        if whisper is not None and whisper.alive():
            return VoiceState.READY, whisper.build
        if self._lock.locked() and self._state is VoiceState.STARTING:
            return VoiceState.STARTING, None
        if not (self._root / "cpu" / EXE).is_file():
            return VoiceState.NOT_BUILT, None
        if not self.model_path.is_file():
            return VoiceState.NO_MODEL, None
        return (VoiceState.FAILED if self._failed else VoiceState.NOT_STARTED), None

    # ---- use ------------------------------------------------------------------------------

    async def ensure(self) -> Whisper:
        """The running server, started if needed. Raises ``VoiceError`` with a code:
        ``voice_not_built``, ``voice_no_model`` or a start failure."""
        async with self._lock:
            self._last_used = time.monotonic()
            self._reap()
            if self._whisper is not None:
                return self._whisper
            if not (self._root / "cpu" / EXE).is_file():
                raise VoiceError("voice_not_built")
            if not await asyncio.to_thread(self._model_ok):
                raise VoiceError("voice_no_model")
            self._state = VoiceState.STARTING
            build = "vulkan" if self._use_gpu() else "cpu"
            try:
                whisper = await asyncio.to_thread(self._start, build)
            except VoiceError as exc:
                if build == "cpu":
                    self._failed, self._state = True, VoiceState.FAILED
                    raise
                self._fall_back(str(exc))
                try:
                    whisper = await asyncio.to_thread(self._start, "cpu")
                except VoiceError:
                    self._failed, self._state = True, VoiceState.FAILED
                    raise
            self._whisper, self._failed, self._state = whisper, False, VoiceState.READY
            return whisper

    def touch(self) -> None:
        """Dictation is still going: not idle."""
        self._last_used = time.monotonic()

    async def lost_gpu(self, whisper: Whisper) -> bool:
        """A request to the GPU build failed and it has exited: retry on the CPU build."""
        if whisper.build != "vulkan" or whisper.alive():
            return False
        async with self._lock:
            self._reap()
        return True

    # ---- internals ------------------------------------------------------------------------

    def _start(self, build: str) -> Whisper:
        return self._start_fn(
            self._root / build, self.model_path, self._temp_dir, self._job(), build
        )

    def _use_gpu(self) -> bool:
        if self._cpu_fallback or not (self._root / "vulkan" / EXE).is_file():
            return False
        return self._prefer_gpu()

    def _model_ok(self) -> bool:
        """Only the expected file is loaded. Checked once per file version (size, mtime)."""
        path = self.model_path
        try:
            st = path.stat()
        except OSError:
            return False
        stamp = (st.st_size, st.st_mtime)
        if self._verified == stamp:
            return True
        h = hashlib.sha256()
        with path.open("rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        if h.hexdigest() != self._model_sha256:
            log_event(log, "voice_model_rejected", error_code="digest_mismatch")
            return False
        self._verified = stamp
        return True

    def _reap(self) -> None:
        whisper = self._whisper
        if whisper is None or whisper.alive():
            return
        self._whisper = None
        self._state = VoiceState.NOT_STARTED
        log_event(
            log, "voice_exited", component=whisper.build, error_code=str(whisper.process.returncode)
        )
        if whisper.build == "vulkan":
            self._fall_back("voice_crashed")

    def _fall_back(self, reason: str) -> None:
        self._cpu_fallback = True
        log_event(log, "voice_gpu_fallback", error_code=reason)

    async def _stop(self) -> None:
        whisper, self._whisper = self._whisper, None
        self._state = VoiceState.NOT_STARTED
        if whisper is not None:
            await asyncio.to_thread(whisper.stop)

    async def _watch(self) -> None:
        while True:
            await asyncio.sleep(self._watch_interval_s)
            if self._lock.locked():
                continue
            try:
                async with self._lock:
                    self._reap()
                    idle = time.monotonic() - self._last_used >= self._idle_unload_s
                    if self._whisper is not None and idle:
                        await self._stop()
                        log_event(log, "voice_idle_unloaded")
            except Exception as exc:  # the watcher must survive anything
                log_event(log, "voice_watch_error", error_code=type(exc).__name__)
