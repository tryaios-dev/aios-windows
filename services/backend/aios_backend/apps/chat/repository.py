"""chats.db access for conversations, messages and provider moves."""

from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from db import lookups, outbox
from db.models import Conversation, EvidenceOutbox, Message, Project, ProviderMove

record_event = outbox.record


def get_project(session: Session, project_id: str) -> Project | None:
    return session.get(Project, project_id)


def get_conversation(session: Session, conversation_id: str) -> Conversation | None:
    return session.get(Conversation, conversation_id)


def conversations(session: Session, project_id: str) -> Sequence[Conversation]:
    stmt = select(Conversation).where(Conversation.project_id == project_id)
    return session.scalars(stmt.order_by(Conversation.updated_at.desc())).all()


def moves(session: Session, conversation_ids: Sequence[str]) -> Sequence[ProviderMove]:
    if not conversation_ids:
        return []
    stmt = select(ProviderMove).where(ProviderMove.conversation_id.in_(conversation_ids))
    return session.scalars(stmt.order_by(ProviderMove.id)).all()


def messages(session: Session, conversation_id: str) -> Sequence[Message]:
    stmt = select(Message).where(Message.conversation_id == conversation_id)
    return session.scalars(stmt.order_by(Message.position)).all()


def next_position(session: Session, conversation_id: str) -> int:
    stmt = select(func.max(Message.position)).where(Message.conversation_id == conversation_id)
    current = session.scalar(stmt)
    return 0 if current is None else int(current) + 1


def evidence_seqs(session: Session, outbox_ids: Sequence[int]) -> dict[int, int | None]:
    if not outbox_ids:
        return {}
    stmt = select(EvidenceOutbox.id, EvidenceOutbox.seq).where(EvidenceOutbox.id.in_(outbox_ids))
    return {row_id: seq for row_id, seq in session.execute(stmt)}


def add(session: Session, *rows: object) -> None:
    session.add_all(rows)
    session.flush()


def delete(session: Session, row: object) -> None:
    session.delete(row)
    session.flush()


default_model_id = lookups.default_model_id
