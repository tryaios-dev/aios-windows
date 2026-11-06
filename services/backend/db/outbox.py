"""Queue a content-free evidence event in the outbox, in the caller's transaction.

Every app records its evidence through ``record``. The body may only hold ids, enum values,
digests, counts and flags (Evidence Wire Format v1, section 4; CLAUDE.md invariant 6): a string
with spaces or longer than 128 characters is refused, so a title or message can never slip in.
"""

import json
import re
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from db.models import EvidenceOutbox

BodyValue = str | int | bool | None
_SAFE_STRING = re.compile(r"[A-Za-z0-9_.:+\-]{0,128}")


class ContentInEvidence(ValueError):
    """An evidence body held something that looks like content."""


def check_body(body: dict[str, BodyValue]) -> None:
    for key, value in body.items():
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", key):
            raise ContentInEvidence("evidence body key")
        if isinstance(value, str) and not _SAFE_STRING.fullmatch(value):
            raise ContentInEvidence("evidence body value")
        if not isinstance(value, str | int | bool | type(None)):
            raise ContentInEvidence("evidence body type")


def record(
    session: Session,
    type: str,
    *,
    actor: str = "user",
    project_id: str | None = None,
    conversation_id: str | None = None,
    body: dict[str, BodyValue] | None = None,
) -> EvidenceOutbox:
    data = dict(body or {})
    check_body(data)
    row = EvidenceOutbox(
        event_id=str(uuid.uuid4()),
        type=type,
        actor=actor,
        project_id=project_id,
        conversation_id=conversation_id,
        body=json.dumps(data, sort_keys=True, separators=(",", ":")),
    )
    session.add(row)
    session.flush()  # assigns row.id
    return row


def pending_count(session: Session) -> int:
    stmt = select(func.count()).select_from(EvidenceOutbox).where(EvidenceOutbox.seq.is_(None))
    return int(session.scalar(stmt) or 0)
