"""Evidence rules on the backend side: list queued events and report the writer's state.

The evidence writer (services/evidence-writer, not in this repo yet) drains the outbox,
hash-chains and signs the events, and writes exports. Until it runs, every event is pending
and an export is refused with ``503 writer_unavailable``; nothing is lost.
"""

import json

from sqlalchemy.orm import Session

from aios_backend.apps.evidence import repository as repo
from aios_backend.apps.evidence.schemas import EvidenceEventOut, EvidenceStatus
from aios_backend.errors import AppError

MAX_EVENTS = 1000


def list_events(session: Session, project_id: str | None) -> list[EvidenceEventOut]:
    return [
        EvidenceEventOut(
            id=row.id,
            event_id=row.event_id,
            event_type=row.type,
            actor=row.actor,
            ts=row.time,
            project_id=row.project_id,
            conversation_id=row.conversation_id,
            payload=json.loads(row.body),
            seq=row.seq,
            pending=row.seq is None,
        )
        for row in repo.events(session, project_id, MAX_EVENTS)
    ]


def status(session: Session) -> EvidenceStatus:
    return EvidenceStatus(writer="unavailable", pending=repo.pending_count(session))


def export(session: Session) -> None:
    raise AppError("writer_unavailable", 503)
