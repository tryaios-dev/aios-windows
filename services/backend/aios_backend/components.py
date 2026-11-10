"""States of the processes the backend reports on GET /health (MVP 9.3).

The process manager (``aios_backend.engine.manager``) updates the ``engine*`` fields and the
evidence-writer client (F-01) updates ``evidence_writer``; until F-01 it stays ``not_started``.
"""

from dataclasses import dataclass
from enum import StrEnum


class ComponentState(StrEnum):
    NOT_STARTED = "not_started"
    STARTING = "starting"
    OK = "ok"
    DEGRADED = "degraded"
    FAILED = "failed"


@dataclass
class Components:
    engine: ComponentState = ComponentState.NOT_STARTED
    engine_build: str | None = None  # cpu | vulkan, while starting or running
    engine_model: str | None = None  # model file name, while starting or running
    engine_cpu_fallback: bool = False  # the GPU build failed this session; CPU build in use
    engine_idle_unloaded: bool = False  # stopped after the idle period; next request restarts it
    evidence_writer: ComponentState = ComponentState.NOT_STARTED
