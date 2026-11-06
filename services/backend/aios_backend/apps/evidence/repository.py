"""chats.db access for evidence: the outbox only. The backend never opens evidence.db (invariant 5)."""

from collections.abc import Sequence

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from db import outbox
from db.models import EvidenceOutbox

pending_count = outbox.pending_count


def events(session: Session, project_id: str | None, limit: int) -> Sequence[EvidenceOutbox]:
    stmt = select(EvidenceOutbox)
    if project_id is not None:
        # A project's view includes installation-wide events (store creation, model installs).
        stmt = stmt.where(
            or_(EvidenceOutbox.project_id == project_id, EvidenceOutbox.project_id.is_(None))
        )
    return session.scalars(stmt.order_by(EvidenceOutbox.id.desc()).limit(limit)).all()[::-1]
