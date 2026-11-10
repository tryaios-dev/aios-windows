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

    def acknowledge_fallback(self) -> None: ...


def get_local_engine(request: Request) -> LocalEngine | None:
    engine: LocalEngine | None = getattr(request.app.state, "local_engine", None)
    return engine


LocalEngineDep = Annotated[LocalEngine | None, Depends(get_local_engine)]
