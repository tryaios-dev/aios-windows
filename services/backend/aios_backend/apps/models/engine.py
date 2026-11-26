"""The seam between the models app and the local engine (llama-server), like chat/answers.py.

``create_app`` puts a ``LocalEngine`` on ``app.state.local_engine`` (``app.state.engine`` is the
process manager, ``aios_backend.engine``). It is ``None`` until an adapter over the process
manager is written: status then comes from ``app.state.components`` (what /health shows) and
start / benchmark answer ``503 engine_unavailable``. Tests plug in a fake.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Protocol

from fastapi import Depends, Request


class EngineBusy(Exception):
    """An answer is being written with the loaded model: it is never cut off (D-05, I-04).
    ``start`` and ``benchmark`` for another model, and ``unload`` of this one, raise it."""


@dataclass(frozen=True)
class Fallback:
    """The GPU build stopped responding and the engine restarted on the CPU build."""

    occurred_at: datetime
    from_build: str
    to_build: str
    acknowledged: bool


@dataclass(frozen=True)
class EngineState:
    # not_started | loading | ready | idle_unloaded | failed
    state: str
    build: str  # cpu | vulkan
    loaded_model_id: str | None
    fallback: Fallback | None = None


@dataclass(frozen=True)
class GpuDevice:
    """A device the engine's GPU build can use, and its free memory now."""

    total_bytes: int
    free_bytes: int
    integrated: bool | None  # built-in graphics sharing system memory; None if unknown


@dataclass(frozen=True)
class BenchmarkRun:
    tokens_per_second: float
    time_to_first_token_ms: int
    build: str  # the build that ran it


class LocalEngine(Protocol):
    def state(self) -> EngineState: ...

    def start(self, model_id: str, model_path: str, cpu_only: bool) -> EngineState:
        """Start the engine (if needed) and load the model. Raises on failure."""
        ...

    def benchmark(self, model_id: str, model_path: str, cpu_only: bool) -> BenchmarkRun: ...

    def unload(self, model_path: str) -> None:
        """Stop the engine if it has this model file loaded, so the file can be deleted."""
        ...

    def acknowledge_fallback(self) -> None: ...

    def devices(self) -> list[GpuDevice] | None:
        """The GPU devices the engine would use ([] if it would run on the CPU build), or None
        while a GPU engine is loaded and free memory cannot be measured."""
        ...


def get_local_engine(request: Request) -> LocalEngine | None:
    engine: LocalEngine | None = getattr(request.app.state, "local_engine", None)
    return engine


LocalEngineDep = Annotated[LocalEngine | None, Depends(get_local_engine)]
