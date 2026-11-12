"""IPC-41, IPC-42, AC-14: the writer answers only the backend's derived token, on loopback."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from tests.conftest import STREAM, TOKEN, genesis

from aios_evidence_writer.app import create_app
from aios_evidence_writer.store import EvidenceStore

AUTH = {"Authorization": f"Bearer {TOKEN}"}


@pytest.fixture
def client(store: EvidenceStore) -> Iterator[TestClient]:
    with TestClient(create_app(store, TOKEN.encode()), client=("127.0.0.1", 50000)) as c:
        yield c


def _genesis_json() -> dict[str, object]:
    g = genesis()
    return {"intent_id": g.intent_id, "type": g.type, "time": g.time, "body": g.body}


@pytest.mark.parametrize(
    "headers", [{}, {"Authorization": "Bearer wrong"}, {"Authorization": TOKEN}]
)
def test_ac_14_unauthenticated_requests_are_refused(
    client: TestClient, headers: dict[str, str]
) -> None:
    r = client.post("/intents", json={"intents": [_genesis_json()]}, headers=headers)
    assert r.status_code == 401
    assert r.json() == {"error": "unauthorized"}
    assert client.get("/events", headers=AUTH).json()["events"] == []


def test_ipc_22_a_non_loopback_caller_is_refused(store: EvidenceStore) -> None:
    with TestClient(create_app(store, TOKEN.encode()), client=("10.0.0.5", 50000)) as c:
        assert c.get("/status", headers=AUTH).status_code == 403


def test_no_docs_pages(client: TestClient) -> None:
    for path in ("/docs", "/openapi.json", "/redoc"):
        assert client.get(path, headers=AUTH).status_code == 404


def test_append_read_and_export_through_the_api(client: TestClient) -> None:
    r = client.post("/intents", json={"intents": [_genesis_json()]}, headers=AUTH)
    assert r.status_code == 200
    assert r.json()["receipts"][0]["seq"] == 0
    assert client.get("/status", headers=AUTH).json()["stream_id"] == STREAM
    r = client.post("/export", json={"scope": {"kind": "stream"}}, headers=AUTH)
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    assert "manifest_digest" in r.headers["x-aios-export"]


def test_errors_are_codes_only(client: TestClient) -> None:
    bad = {**_genesis_json(), "type": "project_created", "body": {"title": "Board pack Q3"}}
    r = client.post("/intents", json={"intents": [bad]}, headers=AUTH)
    assert r.json() == {"error": "body_rejected"}  # content is refused before anything else
    assert "Board" not in r.text
    r = client.post("/intents", json={"intents": [{"nope": 1}]}, headers=AUTH)
    assert r.json() == {"error": "invalid_request"}
