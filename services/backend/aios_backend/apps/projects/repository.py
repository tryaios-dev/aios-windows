"""chats.db access for projects and the rows a project owns (conversations, messages, summaries)."""

from collections.abc import Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from aios_backend.apps.projects.models import ProjectPackage
from db import lookups, outbox
from db.models import Conversation, EvidenceOutbox, Message, Project, Summary

record_event = outbox.record


def list_projects(session: Session, archived: bool | None = None) -> Sequence[Project]:
    stmt = select(Project)
    if archived is not None:
        stmt = stmt.where(Project.archived.is_(archived))
    return session.scalars(stmt.order_by(Project.created_at.desc())).all()


def get_project(session: Session, project_id: str) -> Project | None:
    return session.get(Project, project_id)


def name_taken(session: Session, name: str) -> bool:
    return session.scalar(select(func.count()).where(Project.name == name)) != 0


def add(session: Session, *rows: object) -> None:
    session.add_all(rows)
    session.flush()


def delete_project(session: Session, project: Project) -> None:
    session.delete(project)  # conversations, messages and summaries go by ON DELETE CASCADE
    session.flush()


def conversations(session: Session, project_id: str) -> Sequence[Conversation]:
    stmt = select(Conversation).where(Conversation.project_id == project_id)
    return session.scalars(stmt.order_by(Conversation.created_at)).all()


def messages(session: Session, conversation_id: str) -> Sequence[Message]:
    stmt = select(Message).where(Message.conversation_id == conversation_id)
    return session.scalars(stmt.order_by(Message.position)).all()


def summaries(session: Session, conversation_id: str) -> Sequence[Summary]:
    stmt = select(Summary).where(Summary.conversation_id == conversation_id)
    return session.scalars(stmt.order_by(Summary.created_at)).all()


def evidence_seq(session: Session, outbox_id: int) -> int | None:
    row = session.get(EvidenceOutbox, outbox_id)
    return None if row is None else row.seq


default_model_id = lookups.default_model_id


def packages(session: Session, project_id: str) -> Sequence[ProjectPackage]:
    stmt = select(ProjectPackage).where(ProjectPackage.project_id == project_id)
    return session.scalars(stmt.order_by(ProjectPackage.id.desc())).all()


def imported_before(session: Session, package_id: str) -> bool:
    stmt = select(ProjectPackage.id).where(
        ProjectPackage.package_id == package_id, ProjectPackage.direction == "import"
    )
    return session.scalars(stmt.limit(1)).first() is not None
