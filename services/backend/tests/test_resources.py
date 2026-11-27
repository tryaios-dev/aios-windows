"""Linked resources (Resources page): DeepSeek V4 linked with its own API key, next to the Company
server. Linking stores the key only in the OS key store; a conversation reaches the resource only
after the person allows it; moving back to Local never asks; Company is untouched."""

import json
import logging
from collections.abc import Iterator
from urllib.parse import urlsplit

import httpx
import pytest
from fastapi.testclient import TestClient
from tests.conftest import FakeAnswers

from aios_backend import linked, linked_config, net
from aios_backend.apps.resources import service as resource_service
from aios_backend.apps.settings.service import allowlist
from aios_backend.config import Settings
from db.session import Database

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
    chat.app.state.resource_models = None  # type: ignore[attr-defined]  # no network in tests
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
    unlisted = httpx.MockTransport(DeepSeek(models=("deepseek-embed",)).handler)
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


# ------------------------------------------------------------------ more cloud models + usage
GEMINI, KIMI = "gemini-3-pro", "kimi-k2"


def _model(rid: str) -> str:
    return linked_config.RESOURCES[rid].model_name


def test_more_cloud_models_can_be_linked(resources: TestClient, keystore: dict[str, str]) -> None:
    for rid in (RID, GEMINI, KIMI):
        assert resources.post(f"/resources/{rid}/link", json={"api_key": KEY}).status_code == 200
    assert {r["id"] for r in resources.get("/resources").json()} == {RID, GEMINI, KIMI}
    assert set(keystore) == {linked_config.key_name(r) for r in (RID, GEMINI, KIMI)}


def test_a_conversation_moves_to_the_resource_the_person_picks(
    resources: TestClient, answers: FakeAnswers
) -> None:
    conv = _conversation(resources)
    for rid in (RID, KIMI):
        resources.post(f"/resources/{rid}/link", json={"api_key": KEY})
    moved = resources.post(
        f"/conversations/{conv}/provider",
        json={"to": "resource", "resource_id": KIMI, "confirmed": True},
    )
    assert moved.status_code == 200 and moved.json()["model_id"] == _model(KIMI)
    sent = resources.post(f"/conversations/{conv}/messages", json={"text": "Hi", "allowed": True})
    assert sent.status_code == 200
    assert answers.calls[-1] == {
        **answers.calls[-1],
        "provider": "resource",
        "model_id": _model(KIMI),
    }


def test_without_a_choice_the_first_linked_resource_is_used(resources: TestClient) -> None:
    conv = _conversation(resources)
    resources.post(f"/resources/{GEMINI}/link", json={"api_key": KEY})
    moved = resources.post(
        f"/conversations/{conv}/provider", json={"to": "resource", "confirmed": True}
    )
    assert moved.status_code == 200 and moved.json()["model_id"] == _model(GEMINI)


def test_moving_to_a_resource_that_is_not_linked_is_refused(resources: TestClient) -> None:
    conv = _conversation(resources)
    resources.post(f"/resources/{RID}/link", json={"api_key": KEY})
    refused = resources.post(
        f"/conversations/{conv}/provider",
        json={"to": "resource", "resource_id": GEMINI, "confirmed": True},
    )
    assert refused.status_code == 409 and refused.json()["error"] == "resource_not_linked"


def test_unlinking_one_resource_keeps_the_others(resources: TestClient) -> None:
    conv = _conversation(resources)
    for rid in (RID, KIMI):
        resources.post(f"/resources/{rid}/link", json={"api_key": KEY})
    resources.post(
        f"/conversations/{conv}/provider",
        json={"to": "resource", "resource_id": KIMI, "confirmed": True},
    )
    resources.delete(f"/resources/{RID}")
    sent = resources.post(f"/conversations/{conv}/messages", json={"text": "Hi", "allowed": True})
    assert sent.status_code == 200
    resources.delete(f"/resources/{KIMI}")
    sent = resources.post(f"/conversations/{conv}/messages", json={"text": "Hi", "allowed": True})
    assert sent.status_code == 409 and sent.json()["error"] == "resource_not_linked"


def test_the_allowlist_opens_each_linked_resource_alone(
    settings: Settings, keystore: dict[str, str]
) -> None:
    keystore[linked_config.key_name(KIMI)] = KEY
    rows = {e.id: e.enabled for e in allowlist(settings) if e.id.startswith("linked-")}
    assert rows[f"linked-{KIMI}"] and not rows[f"linked-{RID}"] and not rows[f"linked-{GEMINI}"]
    for rid in linked_config.RESOURCES:
        assert f"linked-{rid}" in rows
        host = urlsplit(linked_config.RESOURCES[rid].base_url).hostname
        assert (host, 443) not in net.FIXED  # only that resource's own client may reach it


def test_usage_counts_tokens_and_cost_this_month(resources: TestClient, db: Database) -> None:
    conv = _conversation(resources)
    resources.post(f"/resources/{KIMI}/link", json={"api_key": KEY})
    with db.session() as session:
        resource_service.set_price(session, KIMI, per_million_in=2.0, per_million_out=8.0)
        session.commit()
    resources.post(
        f"/conversations/{conv}/provider",
        json={"to": "resource", "resource_id": KIMI, "confirmed": True},
    )
    resources.post(f"/conversations/{conv}/messages", json={"text": "Hello", "allowed": True})
    row = resources.get("/resources").json()[0]
    assert row["tokens_in"] > 0 and row["tokens_out"] > 0 and row["uses"] == 1
    expected = (row["tokens_in"] * 2.0 + row["tokens_out"] * 8.0) / 1_000_000
    assert row["spent"] == pytest.approx(expected)
    assert row["price_in"] == 2.0 and row["price_out"] == 8.0


def test_without_a_price_only_tokens_are_counted(resources: TestClient) -> None:
    conv = _conversation(resources)
    resources.post(f"/resources/{GEMINI}/link", json={"api_key": KEY})
    resources.post(f"/conversations/{conv}/provider", json={"to": "resource", "confirmed": True})
    resources.post(f"/conversations/{conv}/messages", json={"text": "Hello", "allowed": True})
    row = resources.get("/resources").json()[0]
    assert row["tokens_out"] > 0 and row["spent"] == 0 and row["price_in"] is None


def test_the_monthly_limit_stops_sending(resources: TestClient, db: Database) -> None:
    conv = _conversation(resources)
    resources.post(f"/resources/{KIMI}/link", json={"api_key": KEY, "monthly_limit": 0.000001})
    with db.session() as session:
        resource_service.set_price(session, KIMI, per_million_in=10.0, per_million_out=10.0)
        session.commit()
    resources.post(
        f"/conversations/{conv}/provider",
        json={"to": "resource", "resource_id": KIMI, "confirmed": True},
    )
    first = resources.post(f"/conversations/{conv}/messages", json={"text": "Hi", "allowed": True})
    assert first.status_code == 200
    second = resources.post(f"/conversations/{conv}/messages", json={"text": "Hi", "allowed": True})
    assert second.status_code == 409 and second.json()["error"] == "resource_limit_reached"


def test_each_linked_resource_answers_with_its_own_key_and_host(
    keystore: dict[str, str],
) -> None:
    other = "sk-" + "c" * 32
    hosts: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        hosts.append(request.url.host)
        key = request.headers.get("authorization", "")
        if request.url.path.endswith("/models"):
            listed = [{"id": f"models/{_model(GEMINI)}"}, {"id": _model(KIMI)}]
            return httpx.Response(200, json={"data": listed})
        assert key == (
            f"Bearer {other}" if request.url.host == "api.moonshot.ai" else f"Bearer {KEY}"
        )
        chunk = {"choices": [{"delta": {"content": request.url.host}}]}
        body = f"data: {json.dumps(chunk)}\n\ndata: [DONE]\n\n"
        return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})

    keystore[linked_config.key_name(GEMINI)] = KEY
    keystore[linked_config.key_name(KIMI)] = other
    side = linked.LinkedResources(transport=httpx.MockTransport(handler))
    gemini = side.model("resource", _model(GEMINI))
    kimi = side.model("resource", _model(KIMI))
    assert gemini is not None and gemini.model_id == _model(GEMINI)  # "models/" prefix is fine
    assert kimi is not None and kimi.model_id == _model(KIMI)
    said = "".join(side.answer("resource", _model(KIMI), [{"role": "user", "content": "Hi"}]))
    assert said == "api.moonshot.ai"
    said = "".join(side.answer("resource", _model(GEMINI), [{"role": "user", "content": "Hi"}]))
    assert said == "generativelanguage.googleapis.com"


def test_the_models_a_key_can_use_are_listed_without_the_key() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.headers.get("authorization") != f"Bearer {KEY}":
            return httpx.Response(401)
        listed = [{"id": "models/gemini-3.1-pro-preview"}, {"id": "models/gemini-3-flash"}]
        return httpx.Response(200, json={"data": listed})

    transport = httpx.MockTransport(handler)
    assert linked.listed_models(GEMINI, KEY, transport=transport) == [
        "gemini-3-flash",
        "gemini-3.1-pro-preview",
    ]
    assert linked.listed_models(GEMINI, "sk-" + "b" * 32, transport=transport) == (
        "resource_key_rejected"
    )
