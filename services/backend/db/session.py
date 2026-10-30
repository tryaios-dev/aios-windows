"""Engine and sessions for chats.db, and the FastAPI dependencies that hand them out."""

import secrets
from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session, sessionmaker

from aios_backend.config import Settings
from aios_common.keystore import get_secret, set_secret
from db.sqlcipher import DatabaseKeyMissing, create_sqlcipher_engine

KEYSTORE_ENTRY = "db-key"


class Database:
    """One per process. The engine is created lazily, so building the app needs no key."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._engine: Engine | None = None
        self._sessions: sessionmaker[Session] | None = None

    def _key(self) -> str:
        if self.settings.db_key is not None:
            return self.settings.db_key
        key = get_secret(KEYSTORE_ENTRY)
        if key:
            return key
        if self.settings.chats_db.exists():
            # Data without its key: never create a new key over it. Needs a restore.
            raise DatabaseKeyMissing("database key missing from keystore")
        key = secrets.token_hex(32)  # first start: new store, key only in the keystore
        set_secret(KEYSTORE_ENTRY, key)
        return key

    @property
    def engine(self) -> Engine:
        if self._engine is None:
            self._key()  # fail before SQLite creates an empty chats.db on first connect
            self.settings.chats_db.parent.mkdir(parents=True, exist_ok=True)
            self._engine = create_sqlcipher_engine(self.settings.chats_db, self._key)
        return self._engine

    def session(self) -> Session:
        if self._sessions is None:
            self._sessions = sessionmaker(self.engine, expire_on_commit=False)
        return self._sessions()

    def status(self) -> str:
        """Content-free state for /health: ok, locked (no key) or error."""
        try:
            with self.engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return "ok"
        except DatabaseKeyMissing:
            return "locked"
        except Exception:
            return "error"

    def dispose(self) -> None:
        if self._engine is not None:
            self._engine.dispose()
            self._engine = None
            self._sessions = None


def get_database(request: Request) -> Database:
    db: Database = request.app.state.db
    return db


def get_session(request: Request) -> Iterator[Session]:
    """One session per request: committed on success, rolled back on error."""
    with get_database(request).session() as session:
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise


# Routes declare ``session: DbSession`` or ``db: Db`` and never import sqlalchemy themselves.
DbSession = Annotated[Session, Depends(get_session)]
Db = Annotated[Database, Depends(get_database)]
