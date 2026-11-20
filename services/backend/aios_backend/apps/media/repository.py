"""chats.db access for pictures and videos."""

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from aios_backend.apps.media.models import MediaItem
from db import outbox
from db.models import Project

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
