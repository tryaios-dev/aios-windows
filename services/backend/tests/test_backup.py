"""Backup (Settings > Backup and recovery, decision D3): a folder that restore accepts as it is.

A backup is a new folder inside the chosen location holding an encrypted, checked copy of
chats.db (SQLite's online backup, E-06), the evidence file (copied by the evidence writer, the only
process that opens it) and recovery.pkg. With the recovery key it restores on a clean device.
"""

import json
from pathlib import Path

from fastapi.testclient import TestClient
from tests.test_setup import first_run, fresh_device

from aios_backend.config import Settings


def choose(client: TestClient, folder: Path | None) -> dict:
    resp = client.put("/backup/location", json={"path": str(folder) if folder else None})
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_backup_needs_a_finished_store(client: TestClient, tmp_path: Path) -> None:
    resp = client.post("/backup")
    assert resp.status_code == 409
    assert resp.json() == {"error": "store_not_created"}


def test_backup_needs_a_location(client: TestClient) -> None:
    first_run(client)
    resp = client.post("/backup")
    assert resp.status_code == 409
    assert resp.json() == {"error": "no_backup_location"}


def test_backup_location_is_an_existing_absolute_folder(client: TestClient, tmp_path: Path) -> None:
    first_run(client)
    assert client.put("/backup/location", json={"path": "relative\\folder"}).json() == {
        "error": "invalid_path"
    }
    missing = tmp_path / "not-there"
    assert client.put("/backup/location", json={"path": str(missing)}).json() == {
        "error": "invalid_path"
    }
    usb = tmp_path / "usb"
    usb.mkdir()
    assert choose(client, usb)["backup_location"] == str(usb)
    assert client.get("/setup/status").json()["backup_location"] == str(usb)
    assert choose(client, None)["backup_location"] is None  # "Set up later"


def test_backup_writes_a_new_folder_and_records_when(client: TestClient, tmp_path: Path) -> None:
    first_run(client)
    usb = tmp_path / "usb"
    usb.mkdir()
    choose(client, usb)

    resp = client.post("/backup")
    assert resp.status_code == 200, resp.text
    out = resp.json()
    folder = Path(out["path"])
    assert folder.parent == usb and folder.is_dir()
    assert {p.name for p in folder.iterdir()} == {"chats.db", "recovery.pkg"}  # no writer in tests
    assert out["size_bytes"] == sum(p.stat().st_size for p in folder.iterdir())
    assert out["files"] == 2

    status = client.get("/setup/status").json()
    assert status["last_backup_at"] is not None
    assert status["last_backup_size"] == out["size_bytes"]

    # A second backup is a second folder; the first one stays as it was.
    second = client.post("/backup").json()
    assert Path(second["path"]) != folder and folder.is_dir()


def test_ac_17_a_backup_restores_on_a_clean_device(
    client: TestClient, settings: Settings, tmp_path: Path
) -> None:
    key = first_run(client)["recovery_key"]
    client.post("/projects", json={"name": "Backed up", "classification": "internal"})
    usb = tmp_path / "usb"
    usb.mkdir()
    choose(client, usb)
    folder = client.post("/backup").json()["path"]

    device = fresh_device(settings, tmp_path)
    resp = device.post("/restore", json={"backup_path": folder, "recovery_key": key})
    assert resp.status_code == 200, resp.text
    assert {p["name"] for p in device.get("/projects").json()} == {"My workspace", "Backed up"}


def test_backup_event_is_content_free(client: TestClient, tmp_path: Path) -> None:
    first_run(client)
    usb = tmp_path / "usb drive with a name"
    usb.mkdir()
    choose(client, usb)
    out = client.post("/backup").json()

    event = client.get("/evidence").json()[-1]
    assert event["event_type"] == "backup_created"
    body = json.dumps(event["payload"])
    assert "usb drive" not in body and out["path"] not in body  # no folder or file names (SR-07)
    assert event["payload"]["size_bytes"] == out["size_bytes"]


def test_a_location_that_went_away_says_so_and_writes_nothing(
    client: TestClient, tmp_path: Path
) -> None:
    first_run(client)
    usb = tmp_path / "usb"
    usb.mkdir()
    choose(client, usb)
    usb.rmdir()  # the drive was unplugged

    resp = client.post("/backup")
    assert resp.status_code == 422
    assert resp.json() == {"error": "backup_location_unavailable"}
    assert client.get("/setup/status").json()["last_backup_at"] is None
