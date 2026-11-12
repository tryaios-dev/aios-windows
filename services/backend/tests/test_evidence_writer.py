"""Backend + a real evidence writer (in process): F-05 pump, F-06 timeline, F-07 export, AC-12, AC-13.

The writer here is the real ``aios_evidence_writer`` app on its own evidence.db, reached through
its HTTP API with the derived token, exactly as backend.exe reaches evidence-writer.exe. Only the
transport is in-process. The backend's own code never imports the writer (AC-14).
"""

import io
import json
import zipfile
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from tests.conftest import LAUNCH_TOKEN, LOOPBACK
from tests.test_setup import first_run

from aios_backend.config import Settings
from aios_backend.evidence import pump
from aios_backend.evidence.client import HttpWriterClient, WriterUnavailable
from aios_backend.main import create_app
from aios_common.canonical import b64url_decode, jcs, sha256_hex
from aios_evidence_writer import chain
from aios_evidence_writer.app import create_app as create_writer_app
from aios_evidence_writer.keys import MemoryKeys
from aios_evidence_writer.store import EvidenceStore
from db.session import Database

WRITER_TOKEN = "77" * 32


class FlakyWriter:
    """Passes calls through, or fails the next ``append`` after the writer has applied it (a
    reply lost on the way back, then a crash)."""

    def __init__(self, inner: HttpWriterClient) -> None:
        self.inner = inner
        self.lose_next_reply = False
        self.down = False

    def __getattr__(self, name: str) -> Any:
        if self.down:
            raise WriterUnavailable("writer_unavailable")
        return getattr(self.inner, name)

    def append(self, intents: list[dict[str, Any]]) -> dict[str, Any]:
        if self.down:
            raise WriterUnavailable("writer_unavailable")
        reply = self.inner.append(intents)
        if self.lose_next_reply:
            self.lose_next_reply = False
            raise WriterUnavailable("writer_unavailable")
        return reply


@pytest.fixture
def store(tmp_path: Path) -> Iterator[EvidenceStore]:
    s = EvidenceStore(tmp_path / "writer" / "evidence.db", MemoryKeys())
    yield s
    s.close()


@pytest.fixture
def writer(store: EvidenceStore) -> Iterator[FlakyWriter]:
    with TestClient(
        create_writer_app(store, WRITER_TOKEN.encode()),
        client=LOOPBACK,
        headers={"Authorization": f"Bearer {WRITER_TOKEN}"},
    ) as http:
        yield FlakyWriter(HttpWriterClient(http))


@pytest.fixture
def app_client(settings: Settings, db: Database, writer: FlakyWriter) -> Iterator[TestClient]:
    headers = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}
    app = create_app(settings, db, writer=writer)  # type: ignore[arg-type]
    with TestClient(app, client=LOOPBACK, headers=headers) as c:
        yield c


def _events(client: TestClient) -> list[dict[str, Any]]:
    return list(client.get("/evidence").json())


def test_f05_queued_events_are_chained_with_their_hashes(
    app_client: TestClient, db: Database, writer: FlakyWriter
) -> None:
    first_run(app_client)
    pump.drain(db, writer)  # type: ignore[arg-type]
    events = _events(app_client)
    assert events and all(not e["pending"] for e in events)
    assert events[0]["event_type"] == "store_created" and events[0]["seq"] == 0
    assert events[0]["prev_hash"] == chain.ZERO_HASH
    for prev, cur in zip(events, events[1:], strict=False):
        assert cur["seq"] == prev["seq"] + 1 and cur["prev_hash"] == prev["event_hash"]
    assert app_client.get("/evidence/status").json() == {"writer": "ok", "pending": 0}


def test_f05_a_lost_reply_never_creates_a_second_event(
    app_client: TestClient, db: Database, writer: FlakyWriter, store: EvidenceStore
) -> None:
    first_run(app_client)
    writer.lose_next_reply = True
    with pytest.raises(WriterUnavailable):
        pump.drain(db, writer)  # type: ignore[arg-type]
    assert all(e["pending"] for e in _events(app_client))  # the backend still waits
    pump.drain(db, writer)  # type: ignore[arg-type]  # replayed from the outbox
    assert len(store.events()) == len(_events(app_client))
    assert not any(e["pending"] for e in _events(app_client))


def test_f05_a_writer_outage_keeps_events_pending_until_it_returns(
    app_client: TestClient, db: Database, writer: FlakyWriter
) -> None:
    first_run(app_client)
    writer.down = True
    with pytest.raises(WriterUnavailable):
        pump.drain(db, writer)  # type: ignore[arg-type]
    assert app_client.get("/evidence/status").json()["pending"] > 0
    writer.down = False
    pump.drain(db, writer)  # type: ignore[arg-type]
    assert app_client.get("/evidence/status").json()["pending"] == 0


def test_ac_12_shutdown_checkpoint_is_mirrored(
    app_client: TestClient, db: Database, writer: FlakyWriter
) -> None:
    first_run(app_client)
    pump.shutdown_checkpoint(db, writer)  # type: ignore[arg-type]
    [cp] = app_client.get("/evidence/checkpoints").json()
    tip = _events(app_client)[-1]
    assert cp["seq_to"] == tip["seq"] and cp["root_hash"] == tip["event_hash"]


def test_the_background_pump_runs_with_the_app(app_client: TestClient) -> None:
    first_run(app_client)
    for _ in range(100):
        if app_client.get("/evidence/status").json() == {"writer": "ok", "pending": 0}:
            break
        import time

        time.sleep(0.05)
    assert app_client.get("/evidence/status").json() == {"writer": "ok", "pending": 0}
    assert app_client.get("/health").json()["evidence_writer"] == "ok"


def _bundle(path: Path) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(path.read_bytes())) as zf:
        return {n: zf.read(n) for n in zf.namelist()}


def test_m6_project_export_is_signed_and_complete(app_client: TestClient, tmp_path: Path) -> None:
    first_run(app_client)
    project = app_client.post("/projects", json={"name": "P", "classification": "public"}).json()
    target = tmp_path / "evidence.zip"
    body = {"scope": "project", "project_id": project["id"], "path": str(target), "confirmed": True}
    resp = app_client.post("/evidence/export", json=body)
    assert resp.status_code == 201, resp.text
    out = resp.json()
    files = _bundle(target)
    manifest = json.loads(files["manifest.json"])
    assert jcs(manifest) == files["manifest.json"]
    assert manifest["custody"] == "self-custodied Local, no anchor"
    assert manifest["scope"]["kind"] == "project"
    assert manifest["tip_hash"] == out["expected_tip"]
    for f in manifest["files"]:
        assert sha256_hex(files[f["path"]]) == f["sha256"]
    sig = json.loads(files["manifest.sig.json"])
    assert chain.verify_manifest(manifest, sig, b64url_decode(manifest["keys"][0]["public_key"]))
    # AC-20: the bundle holds no project name
    assert b'"P"' not in b"".join(files.values())
    # the export itself is recorded, and chained by the next pump run
    exported = [e for e in _events(app_client) if e["event_type"] == "evidence_exported"]
    assert exported and exported[0]["payload"]["export_id"] == manifest["export_id"]


def test_m6_date_range_export(app_client: TestClient, tmp_path: Path) -> None:
    first_run(app_client)
    target = tmp_path / "range.zip"
    body = {
        "scope": "range",
        "from": "2000-01-01T00:00:00Z",
        "to": "2100-01-01T00:00:00Z",
        "path": str(target),
        "confirmed": True,
    }
    assert app_client.post("/evidence/export", json=body).status_code == 201
    assert json.loads(_bundle(target)["manifest.json"])["scope"]["kind"] == "date_range"


def test_export_refuses_a_folder_or_missing_folder(app_client: TestClient, tmp_path: Path) -> None:
    first_run(app_client)
    project = app_client.get("/projects").json()[0]
    base = {"scope": "project", "project_id": project["id"], "confirmed": True}
    for path in (str(tmp_path), str(tmp_path / "missing" / "e.zip")):
        assert app_client.post("/evidence/export", json={**base, "path": path}).json() == {
            "error": "invalid_path"
        }


# ------------------------------------------------------------------ restore drill (M-02, AC-17, AC-18)
def _device(
    settings: Settings, folder: Path, keys: MemoryKeys
) -> tuple[TestClient, Database, EvidenceStore, HttpWriterClient]:
    import dataclasses

    from db import migrate

    local = dataclasses.replace(
        settings,
        chats_db=folder / "data" / "chats.db",
        backups_dir=folder / "backups",
        recovery_pkg=folder / "data" / "recovery.pkg",
    )
    local.chats_db.parent.mkdir(parents=True, exist_ok=True)
    database = Database(local)
    migrate.upgrade(database)
    wstore = EvidenceStore(folder / "data" / "evidence.db", keys)
    http = TestClient(
        create_writer_app(wstore, WRITER_TOKEN.encode()),
        client=LOOPBACK,
        headers={"Authorization": f"Bearer {WRITER_TOKEN}"},
    )
    wclient = HttpWriterClient(http)
    app = create_app(local, database, writer=wclient, signing_seed=lambda: keys.seed() or b"")
    client = TestClient(app, client=LOOPBACK, headers={"Authorization": f"Bearer {LAUNCH_TOKEN}"})
    return client, database, wstore, wclient


def test_m02_restore_drill_continues_the_chain_and_reports_the_branch(
    settings: Settings, tmp_path: Path
) -> None:
    import shutil

    from aios_backend.apps.setup import recovery_package as rp

    # Device A: set up, work, back up (app closed: chats.db copied, writer makes its copy).
    a_keys = MemoryKeys()
    a, a_db, a_store, a_writer = _device(settings, tmp_path / "a", a_keys)
    with a:
        created = first_run(a)
        a.post("/projects", json={"name": "Before backup", "classification": "internal"})
        pump.drain(a_db, a_writer)
        backup = tmp_path / "backup"
        backup.mkdir()
        a_writer.backup(str(backup / "evidence.db"))
        a_db.dispose()
        for name in ("chats.db", "recovery.pkg"):
            shutil.copy2(tmp_path / "a" / "data" / name, backup / name)
        backup_tip = a_store.status()["tip_seq"]

        # Device B: a clean installation restores the backup with the recovery key.
        b_keys = MemoryKeys()  # test profile: the recovered seed is the fixed test seed
        b, b_db, b_store, b_writer = _device(settings, tmp_path / "b", b_keys)
        with b:
            resp = b.post(
                "/restore",
                json={"backup_path": str(backup), "recovery_key": created["recovery_key"]},
            )
            assert resp.status_code == 200, resp.text
            assert resp.json()["epoch"] == 2
            pump.drain(b_db, b_writer)
            events = _events(b)
            assert not any(e["pending"] for e in events)
            cont = [e for e in events if e["event_type"] == "continuation"]
            assert len(cont) == 1 and cont[0]["seq"] == backup_tip + 1 and cont[0]["epoch"] == 2
            assert {p["name"] for p in b.get("/projects").json()} >= {"Before backup"}

            # recovery.pkg now wraps the new key, under the same recovery key.
            pkg = rp.read((tmp_path / "b" / "data" / "recovery.pkg").read_bytes())
            payload = rp.unwrap(pkg, rp.parse_recovery_key(created["recovery_key"]))
            assert payload.signing_seed == b_keys.seed() != a_keys.seed()
            assert pkg["evidence_tip"]["seq"] == backup_tip + 1
            assert b.get("/setup/status").json()["signing_key_id"] == chain.key_id(
                chain.public_key(b_keys.seed() or b"")
            )

            # Device A keeps writing after the backup: the two chains branch at the backup tip.
            a_db2 = Database(a_db.settings)
            a2 = TestClient(
                create_app(a_db.settings, a_db2, writer=a_writer),
                client=LOOPBACK,
                headers={"Authorization": f"Bearer {LAUNCH_TOKEN}"},
            )
            with a2:
                a2.post("/projects", json={"name": "After backup", "classification": "public"})
                pump.drain(a_db2, a_writer)
            old = {e["seq"]: e["event_hash"] for e in a_store.events()}
            new = {e["seq"]: e["event_hash"] for e in b_store.events()}
            assert all(old[s] == new[s] for s in range(backup_tip + 1))
            assert old[backup_tip + 1] != new[backup_tip + 1]  # AC-18: two branches, no merge
        b_store.close()
    a_store.close()


def test_ac_17_restore_refuses_a_tampered_evidence_backup(
    settings: Settings, tmp_path: Path
) -> None:
    import shutil
    import sqlite3

    a_keys = MemoryKeys()
    a, a_db, a_store, a_writer = _device(settings, tmp_path / "a", a_keys)
    with a:
        created = first_run(a)
        pump.drain(a_db, a_writer)
        backup = tmp_path / "backup"
        backup.mkdir()
        a_writer.backup(str(backup / "evidence.db"))
        a_db.dispose()
        for name in ("chats.db", "recovery.pkg"):
            shutil.copy2(tmp_path / "a" / "data" / name, backup / name)
    a_store.close()
    conn = sqlite3.connect(backup / "evidence.db")
    conn.execute("UPDATE events SET json = replace(json, '0.1.0', '9.9.9') WHERE seq = 0")
    conn.commit()
    conn.close()

    b, b_db, b_store, _ = _device(settings, tmp_path / "b", MemoryKeys())
    with b:
        resp = b.post(
            "/restore", json={"backup_path": str(backup), "recovery_key": created["recovery_key"]}
        )
        assert resp.json() == {"error": "r_evidence_invalid"}
        assert b.get("/projects").json() == []  # nothing was restored
        assert b.get("/setup/status").json()["store_created"] is False
    b_store.close()


def test_the_package_names_the_writers_file_in_its_backup_manifest(
    app_client: TestClient, settings: Settings
) -> None:
    first_run(app_client)
    pkg = json.loads(settings.recovery_pkg.read_bytes())
    assert pkg["backup_manifest"]["required"] == ["chats.db", "evidence.db"]
