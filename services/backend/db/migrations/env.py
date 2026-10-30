"""Alembic environment for chats.db.

Called from ``db.migrate`` (database passed in) or from the plain ``alembic``
command with services/backend/alembic.ini (database from $AIOS_ENV, default dev).
"""

from alembic import context

from aios_backend.config import Profile, load
from db.registry import metadata
from db.session import Database

config = context.config


def run() -> None:
    db: Database | None = config.attributes.get("database")
    if db is None:
        settings = load()
        if settings.profile is Profile.DESKTOP:
            raise SystemExit("refusing to run plain alembic against the desktop profile")
        db = Database(settings)

    with db.engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=metadata,
            render_as_batch=True,  # SQLite cannot ALTER most things; batch mode copies the table
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()
        connection.commit()


run()
