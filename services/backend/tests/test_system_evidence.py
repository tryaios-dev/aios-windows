"""System status, support bundle and build facts; evidence stream, events and export checks;
search and project-list filters."""

import dataclasses
import zipfile
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from tests.conftest import LAUNCH_TOKEN, LOOPBACK
from tests.test_setup import first_run

from aios_backend.config import Settings
from aios_backend.main import create_app
from db.session import Database


# ------------------------------------------------------------------ system status
def test_system_status_in_one_call(client: TestClient) -> None:
    out = client.get("/system/status").json()
    assert out["backend"] == "ok" and out["database"] == "ok"
    assert out["engine"] == {"state": "no_model", "build": None, "loaded_model_id": None}
    assert out["writer"] == {"state": "unavailable", "pending": 0}
    assert out["company"] == {
        "enabled": False,
        "reachable": False,
        "base_url": None,
        "model_name": None,
    }
    assert out["generating_conversation_id"] is None


def test_system_status_needs_the_token(anonymous: TestClient) -> None:
    assert anonymous.get("/system/status").status_code == 401


# ------------------------------------------------------------------ support bundle
@pytest.fixture
def logged(settings: Settings, db: Database, tmp_path: Path) -> Iterator[TestClient]:
    """A backend whose log folder also holds a database, like the dev profile's .dev folder."""
    logs = tmp_path / "logs"
    logs.mkdir()
    (logs / "backend.log").write_text("op=start\n")
    (logs / "backend.log.1").write_text("op=older\n")
    (logs / "main.log").write_text("op=window\n")
    (logs / "chats.db").write_bytes(b"secret database")
    (logs / "recovery.pkg").write_bytes(b"wrapped keys")
    with_logs = dataclasses.replace(settings, log_file=logs / "backend.log")
    headers = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}
    with TestClient(create_app(with_logs, db), client=LOOPBACK, headers=headers) as c:
        yield c


def test_support_bundle_holds_logs_only(logged: TestClient, tmp_path: Path) -> None:
    out_dir = tmp_path / "Documents"
    out_dir.mkdir()
    resp = logged.post("/system/support-bundle", json={"path": str(out_dir)})
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["file_count"] == 3 and body["file_name"].startswith("aios-support-bundle-")
    with zipfile.ZipFile(body["path"]) as bundle:
        names = sorted(bundle.namelist())
    assert names == ["logs/backend.log", "logs/backend.log.1", "logs/main.log"]

    named = logged.post("/system/support-bundle", json={"path": str(out_dir / "mine.zip")})
    assert named.json()["file_name"] == "mine.zip"


def test_support_bundle_checks_the_path(logged: TestClient, client: TestClient) -> None:
    assert logged.post("/system/support-bundle", json={"path": "relative"}).json() == {
        "error": "invalid_path"
    }
    no_logs = client.post("/system/support-bundle", json={"path": "C:/"})
    assert no_logs.status_code == 404 and no_logs.json() == {"error": "log_folder_missing"}


def test_system_info(client: TestClient, settings: Settings) -> None:
    info = client.get("/system/info").json()
    assert info["profile"] == "test" and info["schema_version"] >= 5
    assert info["data_paths"]["chats_db"] == str(settings.chats_db)
    assert "evidence" not in str(info["data_paths"])  # the backend declares one database
    assert {"name": "SQLCipher", "role": "Encrypted database", "licence": "BSD-style"} in info[
        "licences"
    ]


# ------------------------------------------------------------------ evidence
def test_evidence_stream(client: TestClient) -> None:
    assert client.get("/evidence/stream").json() == {"error": "store_not_created"}
    created = first_run(client)
    stream = client.get("/evidence/stream").json()
    assert stream["stream_id"] == created["stream_id"]
    assert stream["signer_key_id"] == created["signing_key_id"]
    assert stream["epoch"] == 1 and stream["created_at"] is not None


def test_events_carry_wire_format_fields_and_can_be_fetched_one_by_one(
    client: TestClient,
) -> None:
    created = first_run(client)
    events = client.get("/evidence").json()
    first = events[0]
    assert first["format_version"] == 1 and first["stream_id"] == created["stream_id"]
    assert first["pending"] is True and first["event_hash"] is None and first["epoch"] is None

    one = client.get(f"/evidence/{first['id']}").json()  # pending: addressed by its local id
    assert one == first
    assert client.get("/evidence/99999").json() == {"error": "event_not_found"}
    assert client.get("/evidence/checkpoints").json() == []


def test_evidence_filters(client: TestClient) -> None:
    first_run(client)
    only = client.get("/evidence", params={"event_type": ["project_created"]}).json()
    assert [e["event_type"] for e in only] == ["project_created"]
    two = client.get(
        "/evidence", params={"event_type": ["store_created", "project_created"]}
    ).json()
    assert len(two) == 2
    assert client.get("/evidence", params={"from": "2999-01-01T00:00:00Z"}).json() == []
    assert len(client.get("/evidence", params={"limit": 1}).json()) == 1


def test_evidence_export_checks_then_waits_for_the_writer(client: TestClient) -> None:
    # Without a body: the old call, answered as before.
    assert client.post("/evidence/export").json() == {"error": "writer_unavailable"}

    first_run(client)
    project = client.post("/projects", json={"name": "P", "classification": "public"}).json()
    base = {"scope": "project", "project_id": project["id"], "path": "C:/out/e.zip"}
    assert client.post("/evidence/export", json=base).json() == {"error": "confirmation_required"}
    ok = {**base, "confirmed": True}
    assert client.post("/evidence/export", json={**ok, "project_id": "nope"}).json() == {
        "error": "project_not_found"
    }
    assert client.post("/evidence/export", json={**ok, "path": "rel.zip"}).json() == {
        "error": "invalid_path"
    }
    resp = client.post("/evidence/export", json=ok)
    assert resp.status_code == 503 and resp.json() == {"error": "writer_unavailable"}

    rng = {"scope": "range", "path": "C:/out/e.zip", "confirmed": True}
    backwards = {**rng, "from": "2026-11-06T00:00:00Z", "to": "2026-11-01T00:00:00Z"}
    assert client.post("/evidence/export", json=backwards).json() == {"error": "invalid_range"}
    empty = {**rng, "from": "2001-01-01T00:00:00Z", "to": "2001-01-02T00:00:00Z"}
    assert client.post("/evidence/export", json=empty).json() == {"error": "nothing_to_export"}
    assert client.post("/evidence/export", json={"scope": "range", "path": "C:/x"}).json() == {
        "error": "invalid_request"
    }


# ------------------------------------------------------------------ search and projects
def test_search_filters(chat: TestClient) -> None:
    a = chat.post("/projects", json={"name": "A", "classification": "internal"}).json()
    b = chat.post("/projects", json={"name": "B", "classification": "internal"}).json()
    for project in (a, b):
        conv = chat.post(f"/projects/{project['id']}/conversations", json={}).json()
        chat.post(f"/conversations/{conv['id']}/messages", json={"text": "local question"})

    assert len(chat.get("/search", params={"q": "local"}).json()) == 4
    only_a = chat.get("/search", params={"q": "local", "project_id": a["id"]}).json()
    assert {h["project_id"] for h in only_a} == {a["id"]} and len(only_a) == 2
    users = chat.get("/search", params={"q": "local", "role": "user"}).json()
    assert {h["role"] for h in users} == {"user"} and len(users) == 2
    assert len(chat.get("/search", params={"q": "local", "limit": 1}).json()) == 1

    chat.patch(f"/projects/{b['id']}", json={"archived": True})
    active = chat.get("/search", params={"q": "local", "include_archived": False}).json()
    assert {h["project_id"] for h in active} == {a["id"]}


def test_project_list_filter(client: TestClient) -> None:
    keep = client.post("/projects", json={"name": "Keep", "classification": "public"}).json()
    old = client.post("/projects", json={"name": "Old", "classification": "public"}).json()
    client.patch(f"/projects/{old['id']}", json={"archived": True})
    assert [p["id"] for p in client.get("/projects?archived=false").json()] == [keep["id"]]
    assert [p["id"] for p in client.get("/projects?archived=true").json()] == [old["id"]]
    assert len(client.get("/projects").json()) == 2
