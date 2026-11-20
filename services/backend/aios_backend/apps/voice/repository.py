"""Dictation stores nothing in chats.db: the text goes back to the window, which puts it in the
message box. A recording's text does too; only its Activity event is written here."""

from sqlalchemy.orm import Session

from db import outbox
from db.models import Conversation, Project, Skill

record_event = outbox.record


def get_conversation(session: Session, conversation_id: str) -> Conversation | None:
    return session.get(Conversation, conversation_id)


def get_project(session: Session, project_id: str) -> Project | None:
    return session.get(Project, project_id)


def skill_enabled(session: Session, skill_id: str) -> bool:
    skill = session.get(Skill, skill_id)
    return skill is not None and skill.enabled
