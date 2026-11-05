"""The local inference engine (llama-server) and its lifetime.

``EngineManager`` starts the engine the first time something needs it and stops it with the
backend. The UI never reaches the engine: its port and key stay inside the backend.
"""

import asyncio
from pathlib import Path

from aios_backend.components import Components, ComponentState
from aios_backend.engine.job import KillOnCloseJob
from aios_backend.engine.launcher import Engine, EngineError, find_model, start

__all__ = ["Engine", "EngineError", "EngineManager", "NoModel"]


class NoModel(Exception):
    """No model in the models folder."""


class EngineManager:
    def __init__(
        self, engine_dir: Path, models_dir: Path, temp_dir: Path, components: Components
    ) -> None:
        self._engine_dir = engine_dir
        self._models_dir = models_dir
        self._temp_dir = temp_dir
        self._components = components
        self._engine: Engine | None = None
        self._lock = asyncio.Lock()
        self._job = KillOnCloseJob()

    async def ensure(self) -> Engine:
        """The running engine, started if needed (MVP 11.1: only when a conversation needs it)."""
        async with self._lock:
            if self._engine is not None and self._engine.alive():
                return self._engine
            model = find_model(self._models_dir)
            if model is None:
                raise NoModel
            self._components.engine = ComponentState.STARTING
            try:
                self._engine = await asyncio.to_thread(
                    start, self._engine_dir, model, self._temp_dir, self._job
                )
            except EngineError:
                self._components.engine = ComponentState.FAILED
                raise
            self._components.engine = ComponentState.OK
            return self._engine

    def stop(self) -> None:
        if self._engine is not None:
            self._engine.stop()
            self._engine = None
        self._components.engine = ComponentState.NOT_STARTED
        self._job.close()
