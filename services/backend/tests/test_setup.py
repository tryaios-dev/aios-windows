import dataclasses
import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from tests.conftest import LAUNCH_TOKEN, LOOPBACK

from aios_backend.apps.setup import recovery_package as rp
from aios_backend.config import Settings
from aios_backend.main import create_app
from db import migrate
from db.session import Database

FIRST_RUN_EVENTS = [
    "store_created",
    "recovery_package_written",
    "recovery_key_issued",
    "project_created",
]


def first_run(client: TestClient) -> dict:
    created = client.post("/setup/store")
    assert created.status_code == 201
    done = client.post("/setup/complete")
    assert done.status_code == 200
    return created.json() | done.json()


# ------------------------------------------------------------------ recovery key and package
def test_recovery_key_display_and_parse() -> None:
    key = rp.new_recovery_key()
    text = rp.format_recovery_key(key)
    assert len(text) == 44 and text.count("-") == 8  # 9 groups of 4
    assert rp.parse_recovery_key(text.lower().replace("-", " ")) == key


def test_recovery_key_typing_error_is_caught_before_the_kdf() -> None:
    text = rp.format_recovery_key(rp.new_recovery_key())
    wrong = ("1" if text[0] != "1" else "2") + text[1:]
    for bad in (wrong, text[:-1], text.replace(text[5], "U")):
        with pytest.raises(rp.RecoveryError) as exc:
            rp.parse_recovery_key(bad)
        assert exc.value.code == "R_CHECKSUM"


def test_package_round_trip_and_wrong_key() -> None:
    key, seed, db_key = rp.new_recovery_key(), b"\x01" * 32, b"\x02" * 32
    stream = "11111111-1111-4111-8111-111111111111"
    data, _ = rp.write(recovery_key=key, db_key=db_key, signing_seed=seed, stream_id=stream)
    payload = rp.unwrap(rp.read(data), key)
    assert (payload.db_key, payload.signing_seed, payload.stream_id) == (db_key, seed, stream)
    with pytest.raises(rp.RecoveryError) as exc:
        rp.unwrap(rp.read(data), rp.new_recovery_key())
    assert exc.value.code == "R_UNWRAP"


def test_weak_kdf_parameters_are_rejected_before_running() -> None:
    key = rp.new_recovery_key()
    data, _ = rp.write(
        recovery_key=key,
        db_key=b"\x02" * 32,
        signing_seed=b"\x01" * 32,
        stream_id="11111111-1111-4111-8111-111111111111",
    )
    weak = data.replace(b'"memory_kib":65536', b'"memory_kib":1024')
    with pytest.raises(rp.RecoveryError) as exc:
        rp.read(weak)
    assert exc.value.code == "R_KDF_PARAMS"


# ------------------------------------------------------------------ first run
def test_ac_17_first_run_creates_store_package_and_default_project(
    client: TestClient, settings: Settings
) -> None:
    assert client.get("/setup/status").json()["first_run_complete"] is False
    out = first_run(client)
    assert settings.recovery_pkg.is_file()
    assert rp.read(settings.recovery_pkg.read_bytes())["stream_id"] == out["stream_id"]

    status = client.get("/setup/status").json()
    assert status["first_run_complete"] is True and status["stream_id"] == out["stream_id"]
    projects = client.get("/projects").json()
    assert [(p["name"], p["classification"]) for p in projects] == [("My workspace", "restricted")]
    assert [e["event_type"] for e in client.get("/evidence").json()] == FIRST_RUN_EVENTS


def test_recovery_key_is_returned_once_and_never_recorded(
    client: TestClient, settings: Settings
) -> None:
    out = first_run(client)
    key = out["recovery_key"]
    assert key not in client.get("/evidence").text
    assert key not in client.get("/setup/status").text
    assert key.encode() not in settings.recovery_pkg.read_bytes()
    assert client.post("/setup/store").json() == {"error": "store_exists"}


def test_complete_needs_a_store(client: TestClient) -> None:
    assert client.post("/setup/complete").json() == {"error": "store_not_created"}


# ------------------------------------------------------------------ restore
@pytest.fixture
def backup(client: TestClient, settings: Settings, tmp_path: Path) -> tuple[Path, str]:
    """A first-run store with one extra project, backed up to a folder."""
    out = first_run(client)
    client.post("/projects", json={"name": "Backed up", "classification": "internal"})
    folder = tmp_path / "backup"
    folder.mkdir()
    client.app.state.db.dispose()  # type: ignore[attr-defined]
    shutil.copy2(settings.chats_db, folder / "chats.db")
    shutil.copy2(settings.recovery_pkg, folder / "recovery.pkg")
    return folder, out["recovery_key"]


def fresh_device(settings: Settings, tmp_path: Path) -> TestClient:
    clean = dataclasses.replace(
        settings,
        chats_db=tmp_path / "new" / "chats.db",
        backups_dir=tmp_path / "new" / "backups",
        recovery_pkg=tmp_path / "new" / "recovery.pkg",
    )
    db = Database(clean)
    migrate.upgrade(db)
    return TestClient(
        create_app(clean, db), client=LOOPBACK, headers={"Authorization": f"Bearer {LAUNCH_TOKEN}"}
    )


def test_restore_on_a_clean_device(
    backup: tuple[Path, str], settings: Settings, tmp_path: Path
) -> None:
    folder, key = backup
    device = fresh_device(settings, tmp_path)
    assert device.get("/projects").json() == []

    resp = device.post("/restore", json={"backup_path": str(folder), "recovery_key": key})
    assert resp.status_code == 200, resp.text
    assert {p["name"] for p in device.get("/projects").json()} == {"My workspace", "Backed up"}
    assert device.get("/setup/status").json()["first_run_complete"] is True
    assert device.get("/evidence").json()[-1]["event_type"] == "continuation"


def test_restore_with_the_wrong_key_changes_nothing(
    backup: tuple[Path, str], settings: Settings, tmp_path: Path
) -> None:
    folder, _ = backup
    device = fresh_device(settings, tmp_path)
    wrong = rp.format_recovery_key(rp.new_recovery_key())
    resp = device.post("/restore", json={"backup_path": str(folder), "recovery_key": wrong})
    assert resp.json() == {"error": "r_unwrap"}
    assert device.get("/projects").json() == []


def test_restore_needs_a_recovery_package(
    backup: tuple[Path, str], settings: Settings, tmp_path: Path
) -> None:
    folder, key = backup
    (folder / "recovery.pkg").unlink()
    device = fresh_device(settings, tmp_path)
    resp = device.post("/restore", json={"backup_path": str(folder), "recovery_key": key})
    assert resp.json() == {"error": "no_recovery_package"}


def test_ac_17_restore_refuses_a_backup_missing_a_file_its_package_requires(
    backup: tuple[Path, str], settings: Settings, tmp_path: Path
) -> None:
    folder, key = backup
    (folder / "chats.db").unlink()
    device = fresh_device(settings, tmp_path)
    resp = device.post("/restore", json={"backup_path": str(folder), "recovery_key": key})
    assert resp.json()["error"] in {"r_missing_file", "no_backup_database"}
    assert device.get("/projects").json() == []


def test_ac_17_restore_refuses_a_damaged_database(
    backup: tuple[Path, str], settings: Settings, tmp_path: Path
) -> None:
    folder, key = backup
    data = bytearray((folder / "chats.db").read_bytes())
    data[len(data) // 2 : len(data) // 2 + 64] = bytes(64)  # damage a page in the middle
    (folder / "chats.db").write_bytes(bytes(data))
    device = fresh_device(settings, tmp_path)
    resp = device.post("/restore", json={"backup_path": str(folder), "recovery_key": key})
    assert resp.json()["error"] in {"r_damaged", "r_mismatch"}
    assert device.get("/projects").json() == []


def test_the_package_records_the_mvp_9_4_fields(client: TestClient, settings: Settings) -> None:
    first_run(client)
    pkg = json.loads(settings.recovery_pkg.read_bytes())
    assert pkg["backup_manifest"]["required"] == ["chats.db"]  # no writer in this test
    assert pkg["security_state_revision"]["migration"]
    assert pkg["evidence_tip"] is None  # nothing is chained yet at store creation


def test_restore_over_a_finished_installation_needs_confirmation(
    backup: tuple[Path, str], client: TestClient
) -> None:
    folder, key = backup
    body = {"backup_path": str(folder), "recovery_key": key}
    refused = client.post("/restore", json=body)
    assert refused.status_code == 400 and refused.json() == {"error": "confirmation_required"}

    resp = client.post("/restore", json={**body, "confirmed": True})
    assert resp.status_code == 200, resp.text
    assert resp.json()["epoch"] == 2  # each restore starts a new evidence epoch
    assert client.get("/evidence/stream").json()["epoch"] == 2


def test_restore_on_a_clean_device_needs_no_confirmation_and_reports_the_epoch(
    backup: tuple[Path, str], settings: Settings, tmp_path: Path
) -> None:
    folder, key = backup
    device = fresh_device(settings, tmp_path)
    resp = device.post("/restore", json={"backup_path": str(folder), "recovery_key": key})
    assert resp.json()["epoch"] == 2
