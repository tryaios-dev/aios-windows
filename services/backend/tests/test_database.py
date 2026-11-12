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
from db.models import Project
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
        s.add(
            Project(
                id="p1",
                name="Round trip",
                classification="internal",
                classification_source="project",
            )
        )
        s.commit()
    with db.session() as s:
        assert s.get(Project, "p1").name == "Round trip"  # type: ignore[union-attr]


def test_ac_06_chats_db_is_unreadable_without_the_key(db: Database) -> None:
    with pytest.raises(sqlite3.DatabaseError):
        sqlite3.connect(db.settings.chats_db).execute("SELECT * FROM settings").fetchall()


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


CLASS_COLUMN = {
    "projects": "classification",
    "conversations": "classification_effective",
    "messages": "classification_effective",
    "summaries": "classification_effective",
}


def test_ac_05_every_stored_item_carries_its_class(db: Database) -> None:
    """MVP 12 schema snapshot: every content table records a class, where it came from, and an
    extensions object, so Phase 1b enforcement needs no inference or blanket reclassification."""
    from sqlalchemy import inspect

    inspector = inspect(db.engine)
    for table, class_column in CLASS_COLUMN.items():
        columns = {c["name"]: c for c in inspector.get_columns(table)}
        for required in (class_column, "classification_source", "extensions"):
            assert required in columns, f"{table}.{required} missing"
            assert columns[required]["nullable"] is False, f"{table}.{required} may be null"


def test_providers_table_starts_with_local_only(db: Database) -> None:
    from sqlalchemy import text

    with db.engine.connect() as conn:
        rows = conn.execute(text("SELECT id, type, enabled, credential_ref FROM providers")).all()
    assert [tuple(r) for r in rows] == [("local", "local", 1, None)]


# ------------------------------------------------------------------ E-06 backup before migration
def _put_setting(db: Database, value: str) -> None:
    from sqlalchemy import text

    with db.engine.begin() as conn:
        conn.execute(text("CREATE TABLE IF NOT EXISTS probe (v TEXT)"))
        conn.execute(text("INSERT INTO probe (v) VALUES (:v)"), {"v": value})


def test_e06_backup_opens_with_the_key_and_holds_the_last_write(db: Database) -> None:
    from sqlalchemy import text

    from db.sqlcipher import create_sqlcipher_engine, integrity_ok

    _put_setting(db, "written just before the backup")
    copy = migrate.backup(db)
    assert copy is not None and integrity_ok(copy, db.key_hex())
    engine = create_sqlcipher_engine(copy, db.key_hex)
    with engine.connect() as conn:
        assert (
            conn.execute(text("SELECT v FROM probe")).scalar() == "written just before the backup"
        )
    engine.dispose()
    assert b"written just before" not in copy.read_bytes()  # still encrypted


def test_e06_a_failing_migration_leaves_the_database_as_it_was(
    db: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    from sqlalchemy import text

    migrate.downgrade(db, "0006")
    _put_setting(db, "before the update")
    before = migrate.current(db)

    def broken(cfg: object, revision: str) -> None:
        with db.engine.begin() as conn:
            conn.execute(text("DELETE FROM probe"))  # half-done work...
        raise RuntimeError("migration failed")  # ...then the migration fails

    monkeypatch.setattr(migrate.command, "upgrade", broken)
    with pytest.raises(RuntimeError):
        migrate.upgrade(db)
    monkeypatch.undo()
    assert migrate.current(db) == before
    with db.engine.connect() as conn:
        assert conn.execute(text("SELECT v FROM probe")).scalar() == "before the update"


def test_e06_an_older_build_refuses_a_newer_database_untouched(db: Database) -> None:
    from sqlalchemy import text

    with db.engine.begin() as conn:
        conn.execute(text("UPDATE alembic_version SET version_num = '9999'"))
    db.dispose()
    path = db.settings.chats_db
    stamp = path.read_bytes()
    migrate.backup(db)  # an earlier pre-migration copy exists
    with pytest.raises(migrate.NewerSchema) as refused:
        migrate.upgrade(db)
    assert refused.value.revision == "9999"
    assert refused.value.backup is not None and refused.value.backup.name.startswith("chats-")
    assert path.read_bytes() == stamp
