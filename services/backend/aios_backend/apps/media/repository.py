"""chats.db access for pictures and videos."""

from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from aios_backend.apps.media.models import MediaItem
from db import outbox
from db.models import LinkedResource, Project

record_event = outbox.record


def get_project(session: Session, project_id: str) -> Project | None:
    return session.get(Project, project_id)


def items(session: Session, project_id: str) -> Sequence[MediaItem]:
    return session.scalars(
        select(MediaItem)
        .where(MediaItem.project_id == project_id)
        .order_by(MediaItem.created_at.desc())
    ).all()


def get(session: Session, media_id: str) -> MediaItem | None:
    return session.get(MediaItem, media_id)


def add(session: Session, item: MediaItem) -> None:
    session.add(item)
    session.flush()


def delete(session: Session, item: MediaItem) -> None:
    session.delete(item)
    session.flush()


def linked_resource(session: Session, resource_id: str) -> LinkedResource | None:
    return session.get(LinkedResource, resource_id)


def videos_made(session: Session, resource_id: str, since: datetime) -> int:
    """Finished videos a linked video resource made since ``since``."""
    made = session.scalar(
        select(func.count()).where(
            MediaItem.model == resource_id,
            MediaItem.status == "done",
            MediaItem.finished_at >= since,
        )
    )
    return int(made or 0)
