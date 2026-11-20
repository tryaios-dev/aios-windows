"""chats.db access for linked resources."""

from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from aios_backend.apps.resources.models import LinkedResource
from db.models import Message


def all_linked(session: Session) -> Sequence[LinkedResource]:
    return session.scalars(select(LinkedResource).order_by(LinkedResource.created_at)).all()


def get(session: Session, resource_id: str) -> LinkedResource | None:
    return session.get(LinkedResource, resource_id)


def add(session: Session, row: LinkedResource) -> None:
    session.add(row)
    session.flush()


def delete(session: Session, row: LinkedResource) -> None:
    session.delete(row)
    session.flush()


def answers_by(session: Session, model_id: str) -> int:
    """How many answers a linked resource's model wrote."""
    query = (
        select(func.count())
        .select_from(Message)
        .where(
            Message.provider == "resource",
            Message.model_id == model_id,
            Message.role == "assistant",
        )
    )
    return int(session.scalar(query) or 0)
