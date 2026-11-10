"""Tables only evidence uses. The outbox itself (``evidence_outbox``) is shared: every app writes it
(db/models.py).

These tables hold what the evidence writer *answered*. The backend sends outbox events to the
writer's API and stores its replies here, so the Evidence tab can show chain details without the
backend ever opening evidence.db (CLAUDE.md invariant 5). Hashes and ids only, never content.

``evidence_receipts``: one row per appended event: its epoch and chain hashes (the sequence number
is on the outbox row, ``evidence_outbox.seq``).
``evidence_checkpoints``: signed checkpoints the writer made over a range of sequence numbers.
``evidence_writer_state``: one row (id 1): the writer's last report about the stream.

After changing a table: `uv run aios-backend makemigrations -m "..."` and review the file.
"""

from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base, Timestamps, UTCDateTime

SINGLE_ROW = 1
HASH = String(64)  # SHA-256 as 64 hex characters (or 43 base64url)


class EvidenceReceipt(Base):
    __tablename__ = "evidence_receipts"

    outbox_id: Mapped[int] = mapped_column(
        ForeignKey("evidence_outbox.id", ondelete="CASCADE"), primary_key=True
    )
    epoch: Mapped[int] = mapped_column(Integer)
    prev_hash: Mapped[str] = mapped_column(HASH)
    event_hash: Mapped[str] = mapped_column(HASH)
    appended_at: Mapped[datetime] = mapped_column(UTCDateTime)


class EvidenceCheckpoint(Base):
    __tablename__ = "evidence_checkpoints"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    epoch: Mapped[int] = mapped_column(Integer)
    seq_from: Mapped[int] = mapped_column(Integer)
    seq_to: Mapped[int] = mapped_column(Integer, index=True)
    root_hash: Mapped[str] = mapped_column(HASH)
    signer_key_id: Mapped[str] = mapped_column(String(64))
    signature: Mapped[str] = mapped_column(String(128))  # Ed25519, 64 bytes as hex
    created_at: Mapped[datetime] = mapped_column(UTCDateTime)


class EvidenceWriterState(Timestamps, Base):
    __tablename__ = "evidence_writer_state"
    __table_args__ = (CheckConstraint("id = 1", name="single_row"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=SINGLE_ROW)
    device_id: Mapped[str | None] = mapped_column(String(64))
    epoch: Mapped[int | None] = mapped_column(Integer)
    prior_tip_hash: Mapped[str | None] = mapped_column(HASH)  # tip of the previous epoch
    tip_hash: Mapped[str | None] = mapped_column(HASH)  # newest appended event
    last_seen_at: Mapped[datetime | None] = mapped_column(UTCDateTime)  # last reply from the writer
