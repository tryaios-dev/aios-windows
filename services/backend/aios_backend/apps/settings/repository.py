"""chats.db access for settings: the single row of the ``settings`` table."""

from sqlalchemy.orm import Session

from aios_backend.apps.settings.models import SINGLE_ROW, UserSettings
from db import migrate


def load(session: Session) -> UserSettings:
    """The settings row, created with the defaults the first time it is read."""
    row = session.get(UserSettings, SINGLE_ROW)
    if row is None:
        row = UserSettings(
            id=SINGLE_ROW, update_check=True, catalogue_check=True, safe_mode_cpu=False
        )
        session.add(row)
        session.flush()
    return row


def save(session: Session) -> None:
    session.flush()


def schema_version() -> int:
    head = migrate.head()
    return int(head) if head and head.isdigit() else 0
