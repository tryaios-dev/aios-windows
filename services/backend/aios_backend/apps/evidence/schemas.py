"""Response bodies for the evidence log as the backend sees it: the outbox (UI type EvidenceEvent).

``seq`` is null while an event is pending; the evidence writer assigns it when it appends the
event to the hash chain. Hashes and signatures exist only in the writer's evidence.db.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class EvidenceEventOut(BaseModel):
    id: int  # local order
    event_id: str
    event_type: str
    actor: Literal["user", "app", "operator"]
    ts: datetime
    project_id: str | None
    conversation_id: str | None
    payload: dict[str, str | int | bool | None]
    seq: int | None
    pending: bool


class EvidenceStatus(BaseModel):
    writer: Literal["ok", "unavailable"]
    pending: int
