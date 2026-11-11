"""Response bodies for the evidence log as the backend sees it: the outbox (UI type EvidenceEvent).

``seq`` is null while an event is pending; the evidence writer assigns it when it appends the
event to the hash chain. Hashes, epochs and signatures exist only in the writer's evidence.db,
so those fields stay null here until the writer reports them back.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


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
    # Evidence Wire Format v1 fields. Null while the event is pending.
    format_version: int = 1
    stream_id: str | None = None
    epoch: int | None = None
    provider: Literal["local", "company"] | None = None
    model_digest: str | None = None
    input_commitment: str | None = None
    output_commitment: str | None = None
    prev_hash: str | None = None
    event_hash: str | None = None


class EvidenceStatus(BaseModel):
    writer: Literal["ok", "unavailable"]
    pending: int


class EvidenceStream(BaseModel):
    """This installation's evidence stream. Each restore starts a new epoch."""

    stream_id: str
    device_id: str | None  # assigned by the evidence writer
    epoch: int
    signer_key_id: str
    prior_tip_hash: str | None  # tip of the previous epoch; known to the writer
    created_at: datetime | None


class Checkpoint(BaseModel):
    id: str
    stream_id: str
    epoch: int
    seq_from: int
    seq_to: int
    root_hash: str
    signer_key_id: str
    signature: str
    created_at: datetime


class EvidenceExportIn(BaseModel):
    """What to export. ``path``: where Electron main's save dialog says to write the bundle."""

    scope: Literal["project", "range"]
    project_id: str | None = Field(default=None, max_length=64)
    from_: datetime | None = Field(default=None, alias="from")
    to: datetime | None = None
    path: str = Field(min_length=1, max_length=1024)
    confirmed: bool = False

    model_config = {"populate_by_name": True}

    @model_validator(mode="after")
    def _scope_fields(self) -> "EvidenceExportIn":
        if self.scope == "project" and self.project_id is None:
            raise ValueError("project_id")
        if self.scope == "range" and (self.from_ is None or self.to is None):
            raise ValueError("from/to")
        return self


class EvidenceExportOut(BaseModel):
    file_name: str
    path: str
    size_bytes: int
    stream_id: str
    epoch_range: tuple[int, int]
    first_seq: int
    last_seq: int
    expected_tip: str
    signer_key_ids: list[str]
    checkpoint_ids: list[str]
    custody: str
    exported_at: datetime
    scope: str
