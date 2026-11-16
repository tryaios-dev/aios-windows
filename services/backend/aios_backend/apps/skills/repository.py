"""chats.db access for skills."""

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from db import outbox
from db.models import Skill

record_event = outbox.record


def all_skills(session: Session) -> Sequence[Skill]:
    return session.scalars(select(Skill).order_by(Skill.created_at)).all()


def get(session: Session, skill_id: str) -> Skill | None:
    return session.get(Skill, skill_id)


def add(session: Session, skill: Skill) -> None:
    session.add(skill)
    session.flush()


def delete(session: Session, skill: Skill) -> None:
    session.delete(skill)
    session.flush()
