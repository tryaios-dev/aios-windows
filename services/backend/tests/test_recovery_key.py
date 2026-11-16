"""A new recovery key on a working installation (Settings > Backup and recovery, decision D4).

The same database key and signing key are wrapped again under a new recovery key and recovery.pkg
is written again. The new key is returned once and kept nowhere. Backups made before still open
only with the older key; backups made after open with the new one.
"""

import json
from pathlib import Path

from fastapi.testclient import TestClient
from tests.test_setup import first_run, fresh_device

from aios_backend.apps.setup import recovery_package as rp
from aios_backend.config import Settings


def new_key(client: TestClient) -> dict:
    resp = client.post("/recovery-key")
    assert resp.status_code == 200, resp.text
    return resp.json()


def backup_now(client: TestClient, usb: Path) -> str:
    usb.mkdir(exist_ok=True)
    client.put("/backup/location", json={"path": str(usb)})
    resp = client.post("/backup")
    assert resp.status_code == 200, resp.text
    return resp.json()["path"]


def test_a_new_key_needs_a_store(client: TestClient) -> None:
    resp = client.post("/recovery-key")
    assert resp.status_code == 409
    assert resp.json() == {"error": "store_not_created"}


def test_ac_17_a_new_key_opens_the_package_and_the_old_one_no_longer_does(
    client: TestClient, settings: Settings
) -> None:
    old = first_run(client)["recovery_key"]
    out = new_key(client)
    assert out["recovery_key"] != old
    assert len(out["recovery_key"]) == len(old)  # 9 groups of 4, like the first one

    pkg = rp.read(settings.recovery_pkg.read_bytes())
    assert pkg["package_id"] == out["package_id"]
    rp.unwrap(pkg, rp.parse_recovery_key(out["recovery_key"]))  # opens
    try:
        rp.unwrap(pkg, rp.parse_recovery_key(old))
        raise AssertionError("the old key still opens the new package")
    except rp.RecoveryError as exc:
        assert exc.code == "R_UNWRAP"


def test_backups_open_with_the_key_that_was_current_when_they_were_made(
    client: TestClient, settings: Settings, tmp_path: Path
) -> None:
    old = first_run(client)["recovery_key"]
    before = backup_now(client, tmp_path / "usb")
    fresh = new_key(client)["recovery_key"]
    after = backup_now(client, tmp_path / "usb")

    device = fresh_device(settings, tmp_path)
    wrong = device.post("/restore", json={"backup_path": after, "recovery_key": old})
    assert wrong.status_code == 422  # the older key does not open a newer backup
    ok = device.post("/restore", json={"backup_path": after, "recovery_key": fresh})
    assert ok.status_code == 200, ok.text

    other = fresh_device(settings, tmp_path / "second")
    assert (
        other.post("/restore", json={"backup_path": before, "recovery_key": old}).status_code == 200
    )


def test_a_new_key_is_recorded_without_the_key(client: TestClient) -> None:
    first_run(client)
    out = new_key(client)
    events = client.get("/evidence").json()
    assert [e["event_type"] for e in events[-2:]] == [
        "recovery_package_written",
        "recovery_key_issued",
    ]
    assert events[-1]["payload"]["package_id"] == out["package_id"]
    raw = json.dumps(events)
    assert out["recovery_key"] not in raw and out["recovery_key"].replace("-", "") not in raw

    status = client.get("/setup/status").json()
    assert status["package_id"] == out["package_id"]
    assert status["recovery_key_issued_at"] is not None


def test_first_run_records_when_the_key_was_shown(client: TestClient) -> None:
    first_run(client)
    assert client.get("/setup/status").json()["recovery_key_issued_at"] is not None
