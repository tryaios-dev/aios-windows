"""The local inference engine (llama-server) and its process manager.

The UI never reaches the engine: its port and key stay inside the backend.
"""

from aios_backend.engine.launcher import Engine, EngineError
from aios_backend.engine.manager import Build, EngineManager, NoModel

__all__ = ["Build", "Engine", "EngineError", "EngineManager", "NoModel"]
