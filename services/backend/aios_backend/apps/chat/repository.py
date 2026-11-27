"""chats.db access for conversations, messages and provider moves."""

from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from db import lookups, outbox
from db.models import (
    Conversation,
    EvidenceOutbox,
    KnowledgeDoc,
    LinkedModelPrice,
    LinkedResource,
    Message,
    Project,
    ProviderMove,
    Skill,
    Summary,
)

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


def knowledge_docs(session: Session, ids: Sequence[str]) -> list[KnowledgeDoc]:
    """The chosen documents, in the order chosen; missing ids are left out."""
    if not ids:
        return []
    found = {d.id: d for d in session.scalars(select(KnowledgeDoc).where(KnowledgeDoc.id.in_(ids)))}
    return [found[i] for i in ids if i in found]


def enabled_skill_instructions(session: Session) -> list[str]:
    """What each skill that is on asks of the AI, oldest skill first."""
    stmt = select(Skill.instruction).where(Skill.enabled.is_(True)).order_by(Skill.created_at)
    return list(session.scalars(stmt))


def latest_summary(session: Session, conversation_id: str) -> Summary | None:
    """The newest summary of a conversation (M-07); None while it fits the model's context."""
    return session.scalars(
        select(Summary)
        .where(Summary.conversation_id == conversation_id)
        .order_by(Summary.created_at.desc())
        .limit(1)
    ).first()


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


def linked_resource(session: Session, resource_id: str) -> LinkedResource | None:
    return session.get(LinkedResource, resource_id)


def model_tokens(
    session: Session, model_ids: list[str], since: datetime
) -> dict[str, tuple[int, int]]:
    """Tokens each of a linked resource's models read and wrote since ``since``."""
    query = (
        select(
            Message.model_id,
            func.coalesce(func.sum(Message.prompt_tokens), 0),
            func.coalesce(func.sum(Message.completion_tokens), 0),
        )
        .where(
            Message.provider == "resource",
            Message.model_id.in_(model_ids),
            Message.role == "assistant",
            Message.created_at >= since,
        )
        .group_by(Message.model_id)
    )
    return {str(m): (int(i), int(o)) for m, i, o in session.execute(query).all()}


def model_prices(
    session: Session, model_ids: list[str]
) -> dict[str, tuple[float | None, float | None]]:
    rows = session.scalars(
        select(LinkedModelPrice).where(LinkedModelPrice.model_id.in_(model_ids))
    ).all()
    return {r.model_id: (r.price_in, r.price_out) for r in rows}
