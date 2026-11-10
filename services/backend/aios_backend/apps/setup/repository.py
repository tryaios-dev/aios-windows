"""chats.db access for first-run state, the store identity and the backup being restored."""

from pathlib import Path

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from aios_backend.apps.setup.models import SINGLE_ROW, SetupState, StoreIdentity
from db import outbox
from db.base import utcnow
from db.models import Project
from db.sqlcipher import create_sqlcipher_engine

record_event = outbox.record


def store(session: Session) -> StoreIdentity | None:
    return session.get(StoreIdentity, SINGLE_ROW)


def save_store(session: Session, *, stream_id: str, signing_key_id: str, package_id: str) -> None:
    session.add(
        StoreIdentity(
            id=SINGLE_ROW, stream_id=stream_id, signing_key_id=signing_key_id, package_id=package_id
        )
    )
    session.flush()


def state(session: Session) -> SetupState:
    """The setup_state row, created (first run not done) the first time it is read."""
    row = session.get(SetupState, SINGLE_ROW)
    if row is None:
        row = SetupState(id=SINGLE_ROW, first_run_complete=False, restore_count=0)
        session.add(row)
        session.flush()
    return row


def first_run_done(session: Session) -> bool:
    """Read-only: whether first run finished (no row is created)."""
    row = session.get(SetupState, SINGLE_ROW)
    return bool(row and row.first_run_complete)


def set_first_run_complete(session: Session, default_project_id: str | None) -> None:
    row = state(session)
    if not row.first_run_complete:
        row.first_run_complete = True
        row.completed_at = utcnow()
    if default_project_id is not None:
        row.default_project_id = default_project_id
    session.flush()


def mark_restored(session: Session) -> None:
    row = state(session)
    row.first_run_complete = True
    row.completed_at = row.completed_at or utcnow()
    row.last_restore_at = utcnow()
    row.restore_count += 1
    session.flush()


def first_project(session: Session) -> Project | None:
    return session.scalars(select(Project).order_by(Project.created_at).limit(1)).first()


def project_count(session: Session) -> int:
    return int(session.scalar(select(func.count()).select_from(Project)) or 0)


def add(session: Session, *rows: object) -> None:
    session.add_all(rows)
    session.flush()


def backup_stream_id(path: Path, key_hex: str) -> str | None:
    """Open a backed-up chats.db with its key and read its evidence stream id.

    Raises if the key does not open the file. Backups made before migration 0003 keep the
    identity as JSON in the old ``preferences`` table.
    """
    engine = create_sqlcipher_engine(path, lambda: key_hex)
    try:
        with engine.connect() as conn:
            tables = set(
                conn.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).scalars()
            )
            if "store_identity" in tables:
                value = conn.execute(
                    text("SELECT stream_id FROM store_identity WHERE id = 1")
                ).scalar()
            elif "preferences" in tables:
                value = conn.execute(
                    text(
                        "SELECT json_extract(value, '$.stream_id') FROM preferences WHERE key = 'store'"
                    )
                ).scalar()
            else:
                value = None
    finally:
        engine.dispose()
    return value if isinstance(value, str) else None
