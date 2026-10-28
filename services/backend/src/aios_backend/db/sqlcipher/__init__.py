"""SQLAlchemy engine on SQLCipher (ST-01).

The ONLY module in the backend that imports sqlcipher3 (enforced by import-linter).
The key is applied with PRAGMA key as the first statement of every new connection.
"""

import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

import sqlcipher3.dbapi2 as sqlcipher
from sqlalchemy import Engine, create_engine, event

_HEX_KEY = re.compile(r"[0-9a-f]{64}")


class DatabaseKeyMissing(RuntimeError):
    """No database key in the keystore: the store was never created, or needs a restore."""


def create_sqlcipher_engine(path: Path, key: Callable[[], str]) -> Engine:
    """Engine for ``path``; ``key()`` returns the 256-bit key as 64 lowercase hex characters.

    ``key`` is called on each new connection so the key lives in memory only briefly
    and an engine can be built (for example to export the OpenAPI schema) without a key.
    """
    engine = create_engine(
        f"sqlite+pysqlite:///{path.as_posix()}",
        module=sqlcipher,
        connect_args={"check_same_thread": False},  # FastAPI runs sync routes in a thread pool
    )

    @event.listens_for(engine, "connect")
    def _unlock(dbapi_conn: Any, _record: Any) -> None:
        hex_key = key()
        if not _HEX_KEY.fullmatch(hex_key):
            raise ValueError("database key must be 64 lowercase hex characters")
        dbapi_conn.execute(f"PRAGMA key = \"x'{hex_key}'\"")
        dbapi_conn.execute("PRAGMA cipher_memory_security = ON")
        dbapi_conn.execute("SELECT count(*) FROM sqlite_master")  # fails fast on a wrong key
        dbapi_conn.execute("PRAGMA foreign_keys = ON")

    return engine
