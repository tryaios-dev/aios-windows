"""Alembic, driven from code: used by backend.exe at start-up, the CLI and the tests.

Migrations live in ``db/migrations/versions`` as numbered files (0001_..., 0002_...).
"""

import shutil
from datetime import UTC, datetime
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory

from db.session import Database

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
KEEP_BACKUPS = 5


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


def backup(db: Database) -> Path | None:
    """Copy chats.db (still encrypted) to backups/, keeping the newest few."""
    src = db.settings.chats_db
    if not src.exists() or src.stat().st_size == 0:
        return None
    folder = db.settings.backups_dir
    folder.mkdir(parents=True, exist_ok=True)
    copy = folder / f"chats-{datetime.now(UTC):%Y%m%dT%H%M%S%f}.db"
    shutil.copy2(src, copy)
    for old in sorted(folder.glob("chats-*.db"))[:-KEEP_BACKUPS]:
        old.unlink()
    return copy


def upgrade(db: Database, revision: str = "head") -> None:
    """Back up chats.db, migrate, and put the backup back if anything fails."""
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
