"""chats.db access for evidence: the outbox and the writer's replies. Never evidence.db (invariant 5)."""

from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from aios_backend.apps.evidence.models import (
    SINGLE_ROW,
    EvidenceCheckpoint,
    EvidenceReceipt,
    EvidenceWriterState,
)
from db import lookups, outbox
from db.models import EvidenceOutbox, Project

pending_count = outbox.pending_count
store_identity = lookups.store_identity
restore_count = lookups.restore_count


def events(
    session: Session,
    project_id: str | None,
    limit: int,
    event_types: Sequence[str] = (),
    since: datetime | None = None,
    until: datetime | None = None,
) -> Sequence[EvidenceOutbox]:
    stmt = select(EvidenceOutbox)
    if project_id is not None:
        # A project's view includes installation-wide events (store creation, model installs).
        stmt = stmt.where(
            or_(EvidenceOutbox.project_id == project_id, EvidenceOutbox.project_id.is_(None))
        )
    if event_types:
        stmt = stmt.where(EvidenceOutbox.type.in_(event_types))
    if since is not None:
        stmt = stmt.where(EvidenceOutbox.time >= since)
    if until is not None:
        stmt = stmt.where(EvidenceOutbox.time <= until)
    return session.scalars(stmt.order_by(EvidenceOutbox.id.desc()).limit(limit)).all()[::-1]


def event_by_seq(session: Session, seq: int) -> EvidenceOutbox | None:
    """The appended event with this sequence number, else the pending event with this local id
    (the UI numbers a pending event by its local id until the writer assigns a seq)."""
    row = session.scalars(select(EvidenceOutbox).where(EvidenceOutbox.seq == seq)).first()
    if row is not None:
        return row
    pending = session.get(EvidenceOutbox, seq)
    return pending if pending is not None and pending.seq is None else None


def count(
    session: Session,
    project_id: str | None,
    since: datetime | None,
    until: datetime | None,
) -> int:
    stmt = select(func.count()).select_from(EvidenceOutbox)
    if project_id is not None:
        stmt = stmt.where(EvidenceOutbox.project_id == project_id)
    if since is not None:
        stmt = stmt.where(EvidenceOutbox.time >= since)
    if until is not None:
        stmt = stmt.where(EvidenceOutbox.time <= until)
    return int(session.scalar(stmt) or 0)


def project_exists(session: Session, project_id: str) -> bool:
    return session.get(Project, project_id) is not None


# ------------------------------------------------------------------ what the writer answered
def receipts(session: Session, outbox_ids: Sequence[int]) -> dict[int, EvidenceReceipt]:
    if not outbox_ids:
        return {}
    stmt = select(EvidenceReceipt).where(EvidenceReceipt.outbox_id.in_(outbox_ids))
    return {r.outbox_id: r for r in session.scalars(stmt)}


def add_receipt(session: Session, receipt: EvidenceReceipt) -> None:
    session.merge(receipt)
    session.flush()


def outbox_row(session: Session, outbox_id: int) -> EvidenceOutbox | None:
    return session.get(EvidenceOutbox, outbox_id)


def checkpoints(
    session: Session, from_seq: int | None, to_seq: int | None
) -> Sequence[EvidenceCheckpoint]:
    stmt = select(EvidenceCheckpoint)
    if from_seq is not None:
        stmt = stmt.where(EvidenceCheckpoint.seq_to >= from_seq)
    if to_seq is not None:
        stmt = stmt.where(EvidenceCheckpoint.seq_from <= to_seq)
    return session.scalars(stmt.order_by(EvidenceCheckpoint.seq_to)).all()


def save_checkpoint(session: Session, checkpoint: EvidenceCheckpoint) -> None:
    session.merge(checkpoint)
    session.flush()


def writer_state(session: Session) -> EvidenceWriterState | None:
    return session.get(EvidenceWriterState, SINGLE_ROW)


def save_writer_state(session: Session, values: dict[str, object]) -> EvidenceWriterState:
    row = writer_state(session)
    if row is None:
        row = EvidenceWriterState(id=SINGLE_ROW, **values)
        session.add(row)
    else:
        for key, value in values.items():
            setattr(row, key, value)
    session.flush()
    return row
