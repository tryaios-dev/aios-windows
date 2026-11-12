"""Alembic, driven from code: used by backend.exe at start-up, the CLI and the tests.

Migrations live in ``db/migrations/versions`` as numbered files (0001_..., 0002_...).

Before any migration (M-18, E-06): close every connection, take a consistent copy through the
online backup API, and open the copy with the key to prove it is usable. A failed migration puts
the copy back. A database written by a newer build is refused untouched (``NewerSchema``), with
the name of the newest backup, so a hand rollback (previous installer, then that backup) is safe.
"""

import shutil
from datetime import UTC, datetime
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from alembic.util.exc import CommandError

from db.session import Database
from db.sqlcipher import backup_encrypted, integrity_ok

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
KEEP_BACKUPS = 5  # per installation; the newest ones (question 18)


class NewerSchema(RuntimeError):
    """chats.db was migrated by a newer build. ``backup`` is the newest pre-migration copy."""

    def __init__(self, revision: str, backup: Path | None) -> None:
        super().__init__("schema_newer_than_build")
        self.revision = revision
        self.backup = backup


class BackupFailed(RuntimeError):
    """The pre-migration copy could not be made or does not open; nothing was migrated."""


def _config(db: Database) -> Config:
    cfg = Config()
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    cfg.attributes["database"] = db  # env.py uses this instead of building its own engine
    return cfg


def head() -> str | None:
    return ScriptDirectory(str(MIGRATIONS_DIR)).get_current_head()


def current(db: Database) -> str | None:
    with db.engine.connect() as conn:
        return MigrationContext.configure(conn).get_current_revision()


def pending(db: Database) -> bool:
    return current(db) != head()


def newest_backup(db: Database) -> Path | None:
    found = (
        sorted(db.settings.backups_dir.glob("chats-*.db"))
        if db.settings.backups_dir.is_dir()
        else []
    )
    return found[-1] if found else None


def check_not_newer(db: Database) -> None:
    """Refuse a database whose schema revision this build does not know (a newer build's)."""
    revision = current(db)
    if revision is None:
        return
    try:
        known = ScriptDirectory(str(MIGRATIONS_DIR)).get_revision(revision)
    except CommandError:
        known = None
    if known is None:
        db.dispose()
        raise NewerSchema(revision, newest_backup(db))


def backup(db: Database) -> Path | None:
    """A verified, encrypted copy of chats.db in backups/, keeping the newest few."""
    src = db.settings.chats_db
    if not src.exists() or src.stat().st_size == 0:
        return None
    db.dispose()  # no open connection while the snapshot is taken
    folder = db.settings.backups_dir
    folder.mkdir(parents=True, exist_ok=True)
    copy = folder / f"chats-{datetime.now(UTC):%Y%m%dT%H%M%S%f}.db"
    key = db.key_hex()
    try:
        backup_encrypted(src, copy, key)
    except Exception as exc:
        copy.unlink(missing_ok=True)
        raise BackupFailed("backup_failed") from exc
    if not integrity_ok(copy, key):
        copy.unlink(missing_ok=True)
        raise BackupFailed("backup_unreadable")
    for old in sorted(folder.glob("chats-*.db"))[:-KEEP_BACKUPS]:
        old.unlink()
    return copy


def upgrade(db: Database, revision: str = "head") -> None:
    """Refuse a newer schema, back up chats.db, migrate, and put the backup back on failure."""
    check_not_newer(db)
    copy = backup(db) if pending(db) else None
    try:
        command.upgrade(_config(db), revision)
    except Exception:
        if copy is not None:
            db.dispose()
            shutil.copy2(copy, db.settings.chats_db)
        raise


def downgrade(db: Database, revision: str) -> None:
    command.downgrade(_config(db), revision)


def make_migration(db: Database, message: str, autogenerate: bool = True) -> None:
    """Write the next numbered migration file from the difference between models and DB."""
    script = ScriptDirectory(str(MIGRATIONS_DIR))
    number = len(list(script.walk_revisions())) + 1
    command.revision(
        _config(db), message=message, autogenerate=autogenerate, rev_id=f"{number:04d}"
    )


def check(db: Database) -> None:
    """Raise if the models contain changes that no migration covers."""
    command.check(_config(db))


def history() -> list[str]:
    script = ScriptDirectory(str(MIGRATIONS_DIR))
    return [f"{s.revision}  {s.doc}" for s in reversed(list(script.walk_revisions()))]
