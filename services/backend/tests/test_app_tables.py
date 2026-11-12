"""The tables added in migration 0006: search index, package history, evidence receipts and
writer state, saved downloads and engine fallbacks."""

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from tests.conftest import LAUNCH_TOKEN, LOOPBACK
from tests.test_models import CONTENT, tiny_entry  # noqa: F401  (fixture)
from tests.test_models_runtime import CHUNK, FakeEngine, FakeMirror, pause_midway, wait_for
from tests.test_setup import first_run

from aios_backend.apps.evidence import service as evidence
from aios_backend.apps.evidence.models import EvidenceWriterState
from aios_backend.apps.models import catalogue
from aios_backend.apps.models.engine import EngineState, Fallback
from aios_backend.config import Settings
from aios_backend.main import create_app
from db import migrate
from db.session import Database

HEADERS = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}


def conversation(client: TestClient) -> dict:
    project = client.post("/projects", json={"name": "P", "classification": "internal"}).json()
    return client.post(f"/projects/{project['id']}/conversations", json={}).json()


def hits(client: TestClient, q: str) -> list[str]:
    return [h["message_id"] for h in client.get("/search", params={"q": q}).json()]


# ------------------------------------------------------------------ search index
def test_index_follows_every_insert_edit_and_delete(chat: TestClient, db: Database) -> None:
    conv = conversation(chat)
    out = chat.post(f"/conversations/{conv['id']}/messages", json={"text": "Quarterly REPORT"})
    user_id = out.json()["user"]["id"]
    assert hits(chat, "report") == [user_id]  # case-insensitive, like before
    assert hits(chat, "erly rep") == [user_id]  # inside words and across a space
    assert hits(chat, "local answer") == [out.json()["assistant"]["id"]]

    chat.post(f"/conversations/{conv['id']}/regenerate")  # the answer's text is replaced
    with db.session() as s:
        s.execute(text("UPDATE messages SET content = 'rewritten' WHERE id = :id"), {"id": user_id})
        s.commit()
    assert hits(chat, "report") == [] and hits(chat, "rewritten") == [user_id]

    chat.delete(f"/conversations/{conv['id']}")
    assert hits(chat, "rewritten") == [] and hits(chat, "local answer") == []
    with db.session() as s:
        assert s.execute(text("SELECT count(*) FROM search_entries")).scalar() == 0


def test_short_queries_and_operator_characters(chat: TestClient) -> None:
    conv = conversation(chat)
    out = chat.post(f"/conversations/{conv['id']}/messages", json={"text": 'say "hi" OR NOT*'})
    user_id = out.json()["user"]["id"]
    assert hits(chat, "hi") == [user_id]  # two characters: substring scan
    assert hits(chat, '"hi" OR') == [user_id]  # quotes and keywords are plain text
    assert hits(chat, "NOT*") == [user_id]


def test_migration_indexes_existing_messages(settings: Settings) -> None:
    db = Database(settings)
    migrate.upgrade(db, "0005")
    # Rows as an older build wrote them: plain SQL, because today's models have newer columns.
    now = "2026-11-01 10:00:00.000000"
    with db.engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO projects (id, name, classification, classification_source,"
                " company_ai_enabled, archived, created_at, updated_at)"
                " VALUES ('p1', 'P', 'public', 'project', 0, 0, :t, :t)"
            ),
            {"t": now},
        )
        conn.execute(
            text(
                "INSERT INTO conversations (id, project_id, title, classification_effective,"
                " classification_source, provider_mode, current_provider, archived, created_at,"
                " updated_at) VALUES ('c1', 'p1', 'T', 'public', 'project', 'local', 'local', 0,"
                " :t, :t)"
            ),
            {"t": now},
        )
        conn.execute(
            text(
                "INSERT INTO messages (id, conversation_id, position, role, content,"
                " classification_effective, classification_source, status, provider,"
                " prompt_tokens, completion_tokens, created_at) VALUES ('m1', 'c1', 0, 'user',"
                " 'written before the index existed', 'public', 'project', 'complete', 'local',"
                " 0, 0, :t)"
            ),
            {"t": now},
        )
    migrate.upgrade(db)
    with TestClient(create_app(settings, db), client=LOOPBACK, headers=HEADERS) as c:
        assert hits(c, "before the index") == ["m1"]
    db.dispose()


# ------------------------------------------------------------------ package history
def test_package_history_and_repeat_import_warning(chat: TestClient, tmp_path: Path) -> None:
    conv = conversation(chat)
    chat.post(f"/conversations/{conv['id']}/messages", json={"text": "q"})
    target = tmp_path / "p.aiosproj"
    exported = chat.post(f"/projects/{conv['project_id']}/export", json={"path": str(target)})
    history = chat.get(f"/projects/{conv['project_id']}/packages").json()
    assert len(history) == 1
    assert history[0]["direction"] == "export"
    assert history[0]["package_id"] == exported.json()["package_id"]
    assert (history[0]["conversations"], history[0]["messages"]) == (1, 2)

    first = chat.post("/projects/import", json={"path": str(target)}).json()
    assert not any("imported before" in w for w in first["warnings"])
    imported = chat.get(f"/projects/{first['project_id']}/packages").json()
    assert [r["direction"] for r in imported] == ["import"]
    assert imported[0]["checksum"] == history[0]["checksum"]

    again = chat.post("/projects/import", json={"path": str(target)}).json()
    assert any("imported before" in w for w in again["warnings"])

    chat.delete(f"/projects/{first['project_id']}")  # history goes with the project
    gone = chat.get(f"/projects/{first['project_id']}/packages")
    assert gone.json() == {"error": "project_not_found"}


# ------------------------------------------------------------------ evidence: the writer's replies
def test_writer_replies_fill_chain_fields_checkpoints_and_status(
    client: TestClient, db: Database
) -> None:
    first_run(client)
    events = client.get("/evidence").json()
    assert client.get("/evidence/status").json()["writer"] == "unavailable"

    with db.session() as s:
        for seq, e in enumerate(events, start=1):
            evidence.record_append(s, e["id"], seq, 1, f"{seq - 1:064x}", f"{seq:064x}")
        evidence.record_checkpoint(s, "cp-1", 1, 1, 2, "ab" * 32, "key-1", "cd" * 64)
        evidence.record_checkpoint(s, "cp-2", 1, 3, len(events), "ef" * 32, "key-1", "01" * 64)
        evidence.record_writer_report(s, "device-1", 3, "aa" * 32, f"{len(events):064x}")
        s.commit()

    appended = client.get("/evidence").json()
    assert all(not e["pending"] for e in appended)
    assert appended[1]["seq"] == 2 and appended[1]["epoch"] == 1
    assert appended[1]["prev_hash"] == f"{1:064x}" and appended[1]["event_hash"] == f"{2:064x}"
    assert client.get("/evidence/2").json()["event_hash"] == f"{2:064x}"  # by seq now

    assert [c["id"] for c in client.get("/evidence/checkpoints").json()] == ["cp-1", "cp-2"]
    assert [c["id"] for c in client.get("/evidence/checkpoints?from_seq=3").json()] == ["cp-2"]
    assert client.get("/evidence/status").json() == {"writer": "ok", "pending": 0}
    stream = client.get("/evidence/stream").json()
    assert (stream["device_id"], stream["epoch"]) == ("device-1", 3)
    assert stream["prior_tip_hash"] == "aa" * 32

    with db.session() as s:  # a writer that stopped answering counts as unavailable again
        state = s.get(EvidenceWriterState, 1)
        assert state is not None
        state.last_seen_at = datetime.now(UTC) - timedelta(minutes=5)
        s.commit()
    assert client.get("/evidence/status").json()["writer"] == "unavailable"


def test_writer_replies_are_checked(db: Database) -> None:
    with db.session() as s:
        with pytest.raises(Exception, match="event_not_found"):
            evidence.record_append(s, 999, 1, 1, "0" * 64, "1" * 64)
        with pytest.raises(Exception, match="invalid_range"):
            evidence.record_checkpoint(s, "x", 1, 5, 2, "0" * 64, "k", "s")


# ------------------------------------------------------------------ saved downloads
def app_client(
    settings: Settings, db: Database, mirror: FakeMirror, engine: FakeEngine | None = None
) -> TestClient:
    return TestClient(
        create_app(settings, db, local_engine=engine, mirror=mirror),
        client=LOOPBACK,
        headers=HEADERS,
    )


def test_a_paused_download_is_listed_after_a_restart(
    settings: Settings,
    db: Database,
    tiny_entry: catalogue.Entry,  # noqa: F811
) -> None:
    mirror = FakeMirror()
    with app_client(settings, db, mirror) as before:
        paused = pause_midway(before, mirror, tiny_entry.id)
        assert paused["received_bytes"] >= 2 * CHUNK

    with app_client(settings, db, mirror) as after:  # a new process: nothing in memory
        listed = after.get("/models/downloads").json()
        assert [(d["entry_id"], d["status"]) for d in listed] == [(tiny_entry.id, "paused")]
        assert listed[0]["received_bytes"] == paused["received_bytes"]
        after.post(f"/models/downloads/{tiny_entry.id}/resume")
        wait_for(after, tiny_entry.id, "done")
        assert mirror.offsets[-1] == paused["received_bytes"]
        with db.session() as s:  # a finished download leaves no row behind
            assert s.execute(text("SELECT count(*) FROM model_downloads")).scalar() == 0


def test_an_interrupted_download_comes_back_paused_and_cancel_forgets_it(
    settings: Settings,
    db: Database,
    tiny_entry: catalogue.Entry,  # noqa: F811
) -> None:
    with db.session() as s:  # what a crash mid-download leaves behind
        s.execute(
            text(
                "INSERT INTO model_downloads (entry_id, status, received_bytes, total_bytes,"
                " started_at, created_at, updated_at) VALUES (:e, 'downloading', 0, :t,"
                " :s, :s, :s)"
            ),
            {"e": tiny_entry.id, "t": len(CONTENT), "s": "2026-11-06 08:00:00.000000"},
        )
        s.commit()
    with app_client(settings, db, FakeMirror()) as c:
        state = c.get(f"/models/downloads/{tiny_entry.id}").json()
        assert state["status"] == "paused" and state["started_at"].startswith("2026-11-06T08:00")
        assert c.delete(f"/models/downloads/{tiny_entry.id}").status_code == 204
        assert c.get("/models/downloads").json() == []
    with db.session() as s:
        assert s.execute(text("SELECT count(*) FROM model_downloads")).scalar() == 0


# ------------------------------------------------------------------ engine fallbacks
def test_a_dismissed_fallback_notice_stays_dismissed_after_a_restart(
    settings: Settings,
    db: Database,
    tmp_path: Path,
    tiny_entry: catalogue.Entry,  # noqa: F811
) -> None:
    at = datetime(2026, 11, 6, 9, 30, tzinfo=UTC)

    def engine_with_fallback() -> FakeEngine:
        engine = FakeEngine()
        engine.current = EngineState("ready", "cpu", None, Fallback(at, "vulkan", "cpu", False))
        return engine

    picked = tmp_path / "picked" / "m.gguf"
    picked.parent.mkdir()
    picked.write_bytes(CONTENT)
    with app_client(settings, db, FakeMirror(), engine_with_fallback()) as c:
        c.post("/models/import", json={"path": str(picked)})
        assert c.get("/engine/status").json()["fallback"]["acknowledged"] is False
        c.post("/engine/fallback/acknowledge")

    # The engine starts again and still reports the same fallback as new.
    with app_client(settings, db, FakeMirror(), engine_with_fallback()) as c:
        assert c.get("/engine/status").json()["fallback"]["acknowledged"] is True
