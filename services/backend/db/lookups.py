"""Small reads and writes of one app's table by other apps, in plain SQL.

Apps never import each other, so an app that needs one value from another app's table uses
this module. Keep this list short; a value many apps need belongs in a shared table (db/models.py).
"""

from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.orm import Session


def default_model_id(session: Session) -> str | None:
    """The default local model chosen in Settings (table of apps/settings)."""
    value = session.execute(text("SELECT default_model_id FROM settings WHERE id = 1")).scalar()
    return value if isinstance(value, str) else None


def clear_default_model(session: Session) -> None:
    """Called by the models app when the default model is deleted."""
    session.execute(text("UPDATE settings SET default_model_id = NULL WHERE id = 1"))


def setting_flag(session: Session, name: str) -> bool:
    """One boolean of the settings row (apps/settings); the column default when there is no row."""
    if name not in ("update_check", "catalogue_check", "safe_mode_cpu"):
        raise ValueError(name)
    value = session.execute(text(f"SELECT {name} FROM settings WHERE id = 1")).scalar()  # noqa: S608
    return name != "safe_mode_cpu" if value is None else bool(value)


def catalogue_version(session: Session) -> str | None:
    """The catalogue version recorded by the last catalogue check (table of apps/settings)."""
    value = session.execute(text("SELECT catalogue_version FROM settings WHERE id = 1")).scalar()
    return value if isinstance(value, str) else None


def _sql_time(value: datetime) -> str:
    """The text form SQLAlchemy uses for DateTime columns on SQLite (UTC, no zone)."""
    return value.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S.%f")


def record_catalogue_check(session: Session, version: str, checked_at: datetime) -> None:
    """Called by the models app after a catalogue check (columns of apps/settings)."""
    now = _sql_time(checked_at)
    session.execute(
        text(
            "INSERT OR IGNORE INTO settings (id, update_check, catalogue_check, safe_mode_cpu,"
            " created_at, updated_at) VALUES (1, 1, 1, 0, :t, :t)"
        ),
        {"t": now},
    )
    session.execute(
        text(
            "UPDATE settings SET catalogue_version = :v, last_catalogue_check = :t,"
            " updated_at = :t WHERE id = 1"
        ),
        {"v": version, "t": now},
    )


def store_identity(session: Session) -> tuple[str, str, datetime | None] | None:
    """(stream_id, signing_key_id, created_at) of the store (table of apps/setup), or None."""
    row = session.execute(
        text("SELECT stream_id, signing_key_id, created_at FROM store_identity WHERE id = 1")
    ).first()
    if row is None:
        return None
    created = row[2]
    if isinstance(created, str):
        created = datetime.fromisoformat(created)
    if isinstance(created, datetime) and created.tzinfo is None:
        created = created.replace(tzinfo=UTC)
    return str(row[0]), str(row[1]), created if isinstance(created, datetime) else None


def restore_count(session: Session) -> int:
    """How often this store was restored (table of apps/setup). Each restore starts an epoch."""
    value = session.execute(text("SELECT restore_count FROM setup_state WHERE id = 1")).scalar()
    return int(value or 0)
