"""The setup and settings tables, the update-check result, and migration 0003's data copy."""

import json

from fastapi.testclient import TestClient
from sqlalchemy import text

from aios_backend.apps.settings.models import UserSettings
from aios_backend.apps.setup.models import SetupState, StoreIdentity
from db import migrate
from db.base import utcnow
from db.session import Database


def test_store_and_first_run_are_rows_in_their_own_tables(client: TestClient, db: Database) -> None:
    status = client.get("/setup/status").json()
    assert status["store_created"] is False and status["recovery_package_present"] is False
    created = client.post("/setup/store").json()
    done = client.post("/setup/complete").json()
    with db.session() as s:
        identity = s.get(StoreIdentity, 1)
        state = s.get(SetupState, 1)
        assert identity is not None and identity.stream_id == created["stream_id"]
        assert identity.package_id == created["package_id"]
        assert state is not None and state.first_run_complete and state.completed_at is not None
        assert state.default_project_id == done["default_project_id"]
    status = client.get("/setup/status").json()
    assert status["recovery_package_present"] is True
    assert status["default_project_id"] == done["default_project_id"]
    assert status["package_id"] == created["package_id"]


def test_completing_twice_keeps_one_default_project(client: TestClient) -> None:
    client.post("/setup/store")
    first = client.post("/setup/complete").json()
    assert client.post("/setup/complete").json() == first
    assert len(client.get("/projects").json()) == 1


def test_complete_before_store_is_refused(client: TestClient) -> None:
    r = client.post("/setup/complete")
    assert (r.status_code, r.json()) == (409, {"error": "store_not_created"})


def test_settings_are_one_typed_row(client: TestClient, db: Database) -> None:
    client.patch("/settings", json={"safe_mode_cpu": True, "default_model_id": "qwen3-8b-q4km"})
    with db.session() as s:
        row = s.get(UserSettings, 1)
        assert row is not None and row.safe_mode_cpu is True
        assert row.default_model_id == "qwen3-8b-q4km"
    assert (
        client.patch("/settings", json={"default_model_id": None}).json()["default_model_id"]
        is None
    )


def test_boolean_settings_cannot_be_null(client: TestClient) -> None:
    r = client.patch("/settings", json={"update_check": None})
    assert (r.status_code, r.json()) == (422, {"error": "invalid_setting"})


def test_update_check_result_is_recorded(client: TestClient) -> None:
    found = {"update_available": {"version": "0.2.0", "size_bytes": 212_000_000}}
    s = client.post("/settings/update-check", json=found).json()
    assert s["update_available"] == found["update_available"] and s["last_update_check"]
    s = client.post("/settings/update-check", json={"update_available": None}).json()
    assert s["update_available"] is None


def test_update_check_is_refused_while_switched_off(client: TestClient) -> None:
    client.patch("/settings", json={"update_check": False})
    r = client.post("/settings/update-check", json={"update_available": None})
    assert (r.status_code, r.json()) == (409, {"error": "update_check_off"})


def test_migration_0003_moves_preferences_into_the_new_tables(db: Database) -> None:
    migrate.downgrade(db, "0002")
    now = utcnow()
    rows = {
        "settings": {
            "update_check": False,
            "catalogue_check": True,
            "safe_mode_cpu": True,
            "default_model_id": "qwen3-4b-q4km",
        },
        "store": {
            "stream_id": "11111111-1111-4111-8111-111111111111",
            "signing_key_id": "ab" * 32,
            "package_id": "22222222-2222-4222-8222-222222222222",
            "created_at": "x",
        },
        "first_run_complete": True,
    }
    with db.engine.begin() as conn:
        for key, value in rows.items():
            conn.execute(
                text(
                    "INSERT INTO preferences (key, value, created_at, updated_at) VALUES (:k, :v, :t, :t)"
                ),
                {"k": key, "v": json.dumps(value), "t": now.isoformat(sep=" ")},
            )
    migrate.upgrade(db)
    with db.session() as s:
        settings, identity, state = (
            s.get(UserSettings, 1),
            s.get(StoreIdentity, 1),
            s.get(SetupState, 1),
        )
        assert settings is not None and (settings.update_check, settings.safe_mode_cpu) == (
            False,
            True,
        )
        assert settings.default_model_id == "qwen3-4b-q4km"
        assert identity is not None and identity.stream_id == rows["store"]["stream_id"]  # type: ignore[index]
        assert state is not None and state.first_run_complete
    migrate.downgrade(db, "0002")  # and back: the rows return to preferences
    with db.engine.connect() as conn:
        keys = set(conn.execute(text("SELECT key FROM preferences")).scalars())
    assert keys == {"settings", "store", "first_run_complete"}
    migrate.upgrade(db)


def test_manual_update_check_is_recorded_while_switched_off(client: TestClient) -> None:
    """ "Check now" runs even when the automatic check is off (Settings > General)."""
    client.patch("/settings", json={"update_check": False})
    r = client.post("/settings/update-check", json={"update_available": None, "manual": True})
    assert r.status_code == 200 and r.json()["last_update_check"] is not None
    assert r.json()["update_check"] is False  # the switch stays as the user left it
