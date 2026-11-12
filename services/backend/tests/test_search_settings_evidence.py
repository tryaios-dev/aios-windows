import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from aios_backend.apps.settings.service import ALLOWLIST
from db.outbox import ContentInEvidence, check_body

ALLOWLIST_FILE = (
    Path(__file__).resolve().parents[3] / "contracts/network-allowlist/v1/allowlist.json"
)


def test_search_finds_messages_with_a_snippet(chat: TestClient) -> None:
    project = chat.post("/projects", json={"name": "P", "classification": "public"}).json()
    conv = chat.post(f"/projects/{project['id']}/conversations", json={}).json()
    chat.post(
        f"/conversations/{conv['id']}/messages", json={"text": "Running AI LOCALLY keeps data here"}
    )

    hits = chat.get("/search", params={"q": "locally"}).json()
    assert len(hits) == 1
    assert hits[0]["project_id"] == project["id"] and hits[0]["role"] == "user"
    assert "LOCALLY" in hits[0]["snippet"]
    assert chat.get("/search", params={"q": "l"}).json() == []  # at least two characters


def test_settings_defaults_and_partial_update(client: TestClient) -> None:
    s = client.get("/settings").json()
    assert (s["update_check"], s["safe_mode_cpu"], s["default_model_id"]) == (True, False, None)
    assert s["app_version"] == "0.1.0" and s["schema_version"] >= 2

    s = client.patch("/settings", json={"safe_mode_cpu": True}).json()
    assert s["safe_mode_cpu"] is True and s["update_check"] is True
    s = client.patch("/settings", json={"default_model_id": "qwen3-8b-q4km"}).json()
    assert s["default_model_id"] == "qwen3-8b-q4km" and s["safe_mode_cpu"] is True


def test_new_conversations_use_the_default_model(client: TestClient) -> None:
    client.patch("/settings", json={"default_model_id": "qwen3-4b-q4km"})
    project = client.post("/projects", json={"name": "P", "classification": "public"}).json()
    conv = client.post(f"/projects/{project['id']}/conversations", json={}).json()
    assert conv["model_id"] == "qwen3-4b-q4km"


def test_network_list_matches_the_contract(client: TestClient) -> None:
    contract = json.loads(ALLOWLIST_FILE.read_text("utf-8"))["flows"]
    assert [(f["id"], f["host"], f["port"]) for f in contract] == [
        (a[0], a[1], a[2]) for a in ALLOWLIST
    ]
    flows = client.get("/system/network").json()
    assert [f["enabled"] for f in flows] == [True, True, False]  # Company server off by default


def test_evidence_is_pending_until_the_writer_runs(client: TestClient) -> None:
    client.post("/projects", json={"name": "P", "classification": "public"})
    assert client.get("/evidence/status").json() == {"writer": "unavailable", "pending": 1}
    event = client.get("/evidence").json()[0]
    assert event["pending"] is True and event["seq"] is None
    assert client.post("/evidence/export").json() == {"error": "writer_unavailable"}


@pytest.mark.parametrize(
    "body",
    [{"title": "My secret project"}, {"text": "x" * 200}, {"Bad Key": "x"}, {"n": 1.5}],
)
def test_outbox_refuses_content(body: dict) -> None:
    with pytest.raises(ContentInEvidence):
        check_body(body)


def test_ac_08_search_index_rebuilds_after_damage(chat: TestClient) -> None:
    """H-02: the index is derived data; the repair command rebuilds it from the messages."""
    from sqlalchemy import text

    from db import search_index

    db = chat.app.state.db  # type: ignore[attr-defined]
    for name in ("Alpha", "Beta"):
        project = chat.post("/projects", json={"name": name, "classification": "public"}).json()
        conv = chat.post(f"/projects/{project['id']}/conversations", json={}).json()
        chat.post(f"/conversations/{conv['id']}/messages", json={"text": f"quarterly {name} plan"})
    assert len(chat.get("/search", params={"q": "quarterly"}).json()) == 2

    with db.engine.begin() as conn:  # damage: the index loses its rows
        conn.execute(text("DROP TABLE message_search"))
        conn.execute(
            text(
                "CREATE VIRTUAL TABLE message_search USING fts5(content, tokenize = 'trigram', content = '')"
            )
        )
    assert chat.get("/search", params={"q": "quarterly"}).json() == []

    assert search_index.rebuild(db) == 4  # two questions, two answers
    hits = chat.get("/search", params={"q": "quarterly"}).json()
    assert {h["project_id"] for h in hits} and len(hits) == 2
    # the triggers still work after a rebuild
    project = chat.post("/projects", json={"name": "Gamma", "classification": "public"}).json()
    conv = chat.post(f"/projects/{project['id']}/conversations", json={}).json()
    chat.post(f"/conversations/{conv['id']}/messages", json={"text": "quarterly Gamma plan"})
    assert len(chat.get("/search", params={"q": "quarterly"}).json()) == 3
