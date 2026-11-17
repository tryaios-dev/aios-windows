"""chats.db access for settings: the single row of the ``settings`` table."""

from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from aios_backend.apps.settings.models import SINGLE_ROW, UserSettings
from db import migrate


def load(session: Session) -> UserSettings:
    """The settings row, created with the defaults the first time it is read."""
    row = session.get(UserSettings, SINGLE_ROW)
    if row is None:
        # Another request may create it at the same moment (the window asks in parallel at start).
        session.execute(
            sqlite_insert(UserSettings)
            .values(id=SINGLE_ROW, update_check=True, catalogue_check=True, safe_mode_cpu=False)
            .on_conflict_do_nothing()
        )
        row = session.get(UserSettings, SINGLE_ROW)
        assert row is not None
    return row


def find(session: Session) -> UserSettings | None:
    """The settings row, or None before it is first created. Never writes."""
    return session.get(UserSettings, SINGLE_ROW)


def save(session: Session) -> None:
    session.flush()


def schema_version() -> int:
    head = migrate.head()
    return int(head) if head and head.isdigit() else 0
