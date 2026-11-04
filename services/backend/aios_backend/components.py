"""States of the processes the backend reports on GET /health (MVP 9.3).

The process manager (D-05) updates ``engine`` and the evidence-writer client (F-01) updates
``evidence_writer``; until those exist both stay ``not_started``.
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
    evidence_writer: ComponentState = ComponentState.NOT_STARTED
