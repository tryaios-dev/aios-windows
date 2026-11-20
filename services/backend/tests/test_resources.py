"""Linked resources (Resources page): DeepSeek V4 linked with its own API key, next to the Company
server. Linking stores the key only in the OS key store; a conversation reaches the resource only
after the person allows it; moving back to Local never asks; Company is untouched."""

import json
import logging
from collections.abc import Iterator

import httpx
import pytest
from fastapi.testclient import TestClient

from aios_backend import linked, linked_config, net
from aios_backend.apps.settings.service import allowlist
from aios_backend.config import Settings

KEY = "sk-" + "a" * 32
RID = "deepseek-v4"
MODEL = "deepseek-v4-pro"


@pytest.fixture
def keystore(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    """The OS key store, in memory."""
    store: dict[str, str] = {}
    monkeypatch.setattr(linked_config, "get_secret", store.get)
    monkeypatch.setattr(linked_config, "set_secret", store.__setitem__)
    monkeypatch.setattr(linked_config, "delete_secret", store.pop)
    return store


@pytest.fixture
def resources(chat: TestClient, keystore: dict[str, str]) -> Iterator[TestClient]:
    checked: list[tuple[str, str]] = []
    chat.app.state.resource_check = lambda rid, key: checked.append((rid, key))  # type: ignore[attr-defined]
    yield chat


def _conversation(chat: TestClient) -> str:
    project = chat.post("/projects", json={"name": "P", "classification": "internal"}).json()
    return str(chat.post(f"/projects/{project['id']}/conversations", json={}).json()["id"])


def test_link_stores_the_key_only_in_the_key_store(
    resources: TestClient, keystore: dict[str, str], caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    resp = resources.post(f"/resources/{RID}/link", json={"api_key": KEY, "monthly_limit": 25})
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == RID and body["model_id"] == MODEL and body["monthly_limit"] == 25
    assert keystore == {linked_config.key_name(RID): KEY}
    assert KEY not in resp.text and KEY not in caplog.text
    assert [r["id"] for r in resources.get("/resources").json()] == [RID]


def test_unlink_removes_the_key(resources: TestClient, keystore: dict[str, str]) -> None:
    resources.post(f"/resources/{RID}/link", json={"api_key": KEY})
    assert resources.delete(f"/resources/{RID}").status_code == 204
    assert keystore == {}
    assert resources.get("/resources").json() == []


def test_a_rejected_key_is_not_stored(resources: TestClient, keystore: dict[str, str]) -> None:
    resources.app.state.resource_check = lambda rid, key: "resource_key_rejected"  # type: ignore[attr-defined]
    resp = resources.post(f"/resources/{RID}/link", json={"api_key": KEY})
    assert resp.status_code == 400 and resp.json()["error"] == "resource_key_rejected"
    assert keystore == {}


def test_an_unknown_resource_cannot_be_linked(resources: TestClient) -> None:
    assert resources.post("/resources/nope/link", json={"api_key": KEY}).status_code == 404


def test_moving_to_a_resource_needs_a_link_and_asks_first(resources: TestClient) -> None:
    conv = _conversation(resources)
    move = f"/conversations/{conv}/provider"
    not_linked = resources.post(move, json={"to": "resource", "confirmed": True})
    assert not_linked.status_code == 409 and not_linked.json()["error"] == "resource_not_linked"

    resources.post(f"/resources/{RID}/link", json={"api_key": KEY})
    unasked = resources.post(move, json={"to": "resource"})
    assert unasked.status_code == 400 and unasked.json()["error"] == "confirmation_required"

    moved = resources.post(move, json={"to": "resource", "confirmed": True})
    assert moved.status_code == 200 and moved.json()["current_provider"] == "resource"
    events = resources.get("/evidence").json()
    disclosed = [e for e in events if e["event_type"] == "disclosure_confirmed"][-1]
    assert disclosed["payload"]["provider"] == "resource"

    back = resources.post(move, json={"to": "local"})  # never asks
    assert back.status_code == 200 and back.json()["current_provider"] == "local"


def test_a_resource_conversation_is_answered_by_the_resource(resources: TestClient) -> None:
    conv = _conversation(resources)
    resources.post(f"/resources/{RID}/link", json={"api_key": KEY})
    resources.post(f"/conversations/{conv}/provider", json={"to": "resource", "confirmed": True})
    unasked = resources.post(f"/conversations/{conv}/messages", json={"text": "Hello"})
    assert unasked.status_code == 400 and unasked.json()["error"] == "allow_once_required"
    before = len(resources.get("/evidence").json())
    sent = resources.post(
        f"/conversations/{conv}/messages", json={"text": "Hello", "allowed": True}
    )
    assert sent.status_code == 200
    kinds = [e["event_type"] for e in resources.get("/evidence").json()[before:]]
    assert "disclosure_confirmed" in kinds  # every allowed send is recorded
    answer = resources.get(f"/conversations/{conv}/messages").json()[-1]
    assert answer["provider"] == "resource"
    done = [
        e for e in resources.get("/evidence").json() if e["event_type"] == "inference_completed"
    ]
    assert done[-1]["payload"]["provider"] == "resource"


def test_unlinking_stops_a_resource_conversation(resources: TestClient) -> None:
    conv = _conversation(resources)
    resources.post(f"/resources/{RID}/link", json={"api_key": KEY})
    resources.post(f"/conversations/{conv}/provider", json={"to": "resource", "confirmed": True})
    resources.delete(f"/resources/{RID}")
    sent = resources.post(
        f"/conversations/{conv}/messages", json={"text": "Hello", "allowed": True}
    )
    assert sent.status_code == 409 and sent.json()["error"] == "resource_not_linked"


def test_the_allowlist_shows_deepseek_only_while_linked(
    settings: Settings, keystore: dict[str, str]
) -> None:
    def row() -> bool:
        return next(e for e in allowlist(settings) if e.id == f"linked-{RID}").enabled

    assert not row()
    keystore[linked_config.key_name(RID)] = KEY
    assert row()
    assert ("api.deepseek.com", 443) not in net.FIXED  # no other client may reach it


# ------------------------------------------------------------------ the HTTP side (gateway)
class DeepSeek:
    """DeepSeek's API as an httpx transport."""

    def __init__(self, models: tuple[str, ...] = (MODEL, "deepseek-flash")) -> None:
        self.models = models
        self.requests: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.headers.get("authorization") != f"Bearer {KEY}":
            return httpx.Response(401)
        if request.url.path == "/v1/models":
            return httpx.Response(200, json={"data": [{"id": m} for m in self.models]})
        if request.url.path == "/v1/chat/completions":
            chunks = [{"choices": [{"delta": {"content": w}}]} for w in ("Hi", " there")]
            lines = "".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n"
            return httpx.Response(200, text=lines, headers={"content-type": "text/event-stream"})
        return httpx.Response(404)


def test_the_resource_side_answers_with_the_resource_key(keystore: dict[str, str]) -> None:
    server = DeepSeek()
    side = linked.LinkedResources(transport=httpx.MockTransport(server.handler))
    assert side.model("resource", None) is None  # nothing linked yet
    keystore[linked_config.key_name(RID)] = KEY
    info = side.model("resource", None)
    assert info is not None and info.model_id == MODEL
    assert side.model("company", None) is None  # never answers for Company
    assert (
        "".join(side.answer("resource", MODEL, [{"role": "user", "content": "Hi"}])) == "Hi there"
    )
    assert {r.url.host for r in server.requests} == {"api.deepseek.com"}


def test_the_key_check_reports_a_wrong_key() -> None:
    server = DeepSeek()
    transport = httpx.MockTransport(server.handler)
    assert linked.check(RID, KEY, transport=transport) is None
    assert linked.check(RID, "sk-" + "b" * 32, transport=transport) == "resource_key_rejected"
    unlisted = httpx.MockTransport(DeepSeek(models=("other",)).handler)
    assert linked.check(RID, KEY, transport=unlisted) == "resource_model_not_listed"


def test_link_uses_the_key_an_operator_stored(
    resources: TestClient, keystore: dict[str, str]
) -> None:
    """The person only presses Link: no key in the request, the operator's key is used."""
    keystore[linked_config.provisioned_name(RID)] = KEY
    resp = resources.post(f"/resources/{RID}/link", json={"monthly_limit": None})
    assert resp.status_code == 200
    assert keystore[linked_config.key_name(RID)] == KEY
    resources.delete(f"/resources/{RID}")  # unlinking keeps the operator's key for next time
    assert linked_config.provisioned_name(RID) in keystore


def test_link_without_any_key_says_so(resources: TestClient) -> None:
    resp = resources.post(f"/resources/{RID}/link", json={})
    assert resp.status_code == 400 and resp.json()["error"] == "resource_key_missing"


def test_asking_a_resource_again_also_asks_first(resources: TestClient) -> None:
    conv = _conversation(resources)
    resources.post(f"/resources/{RID}/link", json={"api_key": KEY})
    resources.post(f"/conversations/{conv}/provider", json={"to": "resource", "confirmed": True})
    resources.post(f"/conversations/{conv}/messages", json={"text": "Hello", "allowed": True})
    again = resources.post(f"/conversations/{conv}/regenerate")
    assert again.status_code == 400 and again.json()["error"] == "allow_once_required"
    again = resources.post(f"/conversations/{conv}/regenerate", json={"allowed": True})
    assert again.status_code == 200


def test_local_and_company_sends_do_not_ask(resources: TestClient) -> None:
    conv = _conversation(resources)
    assert resources.post(f"/conversations/{conv}/messages", json={"text": "Hi"}).status_code == 200
