import dataclasses
import importlib.metadata
import json
import sqlite3
import sys
from pathlib import Path

import pytest
from sqlalchemy import text

from aios_backend.config import Settings
from db import migrate, session
from db.models import Preference
from db.session import Database
from db.sqlcipher import DatabaseKeyMissing

PIN = json.loads((Path(__file__).resolve().parents[3] / "build/sqlcipher/pin.json").read_text())


def test_ac_14_backend_declares_exactly_one_database(settings: Settings) -> None:
    assert settings.chats_db.name.startswith("chats")
    assert "evidence" not in str(settings.chats_db)


def test_migrations_reach_head_and_match_models(db: Database) -> None:
    assert migrate.current(db) == migrate.head()
    migrate.check(db)  # raises if a model changed without a migration


def test_migrations_downgrade_and_upgrade_again(db: Database) -> None:
    migrate.downgrade(db, "base")
    assert migrate.current(db) is None
    migrate.upgrade(db)
    assert migrate.current(db) == migrate.head()


def test_rows_round_trip(db: Database) -> None:
    with db.session() as s:
        s.add(Preference(key="theme", value='"dark"'))
        s.commit()
    with db.session() as s:
        assert s.get(Preference, "theme").value == '"dark"'  # type: ignore[union-attr]


def test_ac_06_chats_db_is_unreadable_without_the_key(db: Database) -> None:
    with pytest.raises(sqlite3.DatabaseError):
        sqlite3.connect(db.settings.chats_db).execute("SELECT * FROM preferences").fetchall()


def test_ac_06_wrong_key_fails_fast(db: Database) -> None:
    wrong = Database(dataclasses.replace(db.settings, db_key="11" * 32))
    with pytest.raises(Exception), wrong.engine.connect() as conn:  # noqa: B017
        conn.execute(text("SELECT 1"))


def test_first_start_creates_key_in_keystore(settings: Settings, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    store: dict[str, str] = {}
    monkeypatch.setattr(session, "get_secret", store.get)
    monkeypatch.setattr(session, "set_secret", store.__setitem__)
    db = Database(dataclasses.replace(settings, db_key=None))
    migrate.upgrade(db)
    assert len(store["db-key"]) == 64
    assert db.status() == "ok"
    db.dispose()


def test_existing_data_without_key_is_locked_not_rekeyed(settings: Settings, monkeypatch) -> None:  # type: ignore[no-untyped-def]
    settings.chats_db.write_bytes(b"existing encrypted data")
    store: dict[str, str] = {}
    monkeypatch.setattr(session, "get_secret", store.get)
    monkeypatch.setattr(session, "set_secret", store.__setitem__)
    db = Database(dataclasses.replace(settings, db_key=None))
    with pytest.raises(DatabaseKeyMissing):
        db.engine  # noqa: B018
    assert db.status() == "locked"
    assert store == {}  # no new key written over existing data


def test_b02_sqlcipher_build_matches_pin(db: Database) -> None:
    pin = PIN[sys.platform]
    assert importlib.metadata.version(pin["package"]) == pin["version"]
    with db.engine.connect() as conn:
        cipher = conn.execute(text("PRAGMA cipher_version")).scalar()
    if pin["cipher_version"] is not None:  # recorded for the shipped (Windows) build
        assert cipher == pin["cipher_version"]
    else:
        assert cipher, "SQLCipher not active"
