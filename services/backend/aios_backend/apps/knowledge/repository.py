"""chats.db access for My secure knowledge."""

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from db import outbox
from db.models import KnowledgeDoc

record_event = outbox.record


def all_docs(session: Session) -> Sequence[KnowledgeDoc]:
    return session.scalars(select(KnowledgeDoc).order_by(KnowledgeDoc.created_at.desc())).all()


def get(session: Session, doc_id: str) -> KnowledgeDoc | None:
    return session.get(KnowledgeDoc, doc_id)


def find_same(session: Session, name: str, origin: str, size_bytes: int) -> KnowledgeDoc | None:
    """The copy of this very file, if it was added before (same name, folder and size)."""
    return session.scalars(
        select(KnowledgeDoc).where(
            KnowledgeDoc.name == name,
            KnowledgeDoc.origin == origin,
            KnowledgeDoc.size_bytes == size_bytes,
        )
    ).first()


def add(session: Session, doc: KnowledgeDoc) -> None:
    session.add(doc)
    session.flush()


def delete(session: Session, doc: KnowledgeDoc) -> None:
    session.delete(doc)
    session.flush()
