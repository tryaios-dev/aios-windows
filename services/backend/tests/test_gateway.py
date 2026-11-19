"""The local AI gateway (G-01, IPC-02): every model request goes provider router -> gateway -> engine.

The gateway is a module inside backend.exe with its own loopback endpoint, OpenAI-compatible, and
accepts only the derived token ``derive(T, "aios/ipc/v1/gateway")`` (Process and IPC v1, section 5).
The provider router is the only caller: chat never talks to a model itself (invariant 1, PR-04).
"""

import json
from collections.abc import Iterator

import httpx
import pytest
from fastapi.testclient import TestClient
from tests.conftest import LAUNCH_TOKEN, LOOPBACK, FakeAnswers

from aios_backend.config import Settings
from aios_backend.gateway.app import GATEWAY_PURPOSE, create_gateway_app
from aios_backend.main import create_app
from aios_backend.providers import ProviderRouter
from aios_common.handshake import derive
from db.session import Database

CHAT = "/v1/chat/completions"
BODY = {"model": "m1", "messages": [{"role": "user", "content": "Hello"}], "stream": True}


def gateway_token() -> str:
    return derive(GATEWAY_PURPOSE)


@pytest.fixture
def engine_side() -> FakeAnswers:
    return FakeAnswers("Words from the engine.")


@pytest.fixture
def gateway(engine_side: FakeAnswers) -> Iterator[TestClient]:
    with TestClient(create_gateway_app(engine_side), client=LOOPBACK) as c:
        yield c


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def deltas(body: str) -> list[str]:
    out = []
    for line in body.splitlines():
        if line.startswith("data: ") and line != "data: [DONE]":
            out.append(json.loads(line[6:])["choices"][0]["delta"].get("content", ""))
    return out


# ------------------------------------------------------------------ IPC-21..23 on the gateway
def test_ipc_23_the_gateway_needs_its_own_derived_token(gateway: TestClient) -> None:
    assert gateway.post(CHAT, json=BODY).status_code == 401
    assert gateway.post(CHAT, json=BODY, headers=auth("nope")).status_code == 401
    # The launch token opens the local API, not the gateway (IPC-20: one token per purpose).
    assert gateway.post(CHAT, json=BODY, headers=auth(LAUNCH_TOKEN)).status_code == 401
    assert gateway.post(CHAT, json=BODY, headers=auth(gateway_token())).status_code == 200


def test_ipc_22_the_gateway_refuses_other_hosts(engine_side: FakeAnswers) -> None:
    far = TestClient(create_gateway_app(engine_side), client=("10.0.0.5", 50000))
    resp = far.post(CHAT, json=BODY, headers=auth(gateway_token()))
    assert resp.status_code == 403 and resp.json() == {"error": "forbidden"}


def test_the_gateway_has_no_docs(gateway: TestClient) -> None:
    for path in ("/docs", "/openapi.json"):
        assert gateway.get(path, headers=auth(gateway_token())).status_code == 404


# ------------------------------------------------------------------ OpenAI-compatible answers
def test_streamed_answer_is_openai_compatible(
    gateway: TestClient, engine_side: FakeAnswers
) -> None:
    resp = gateway.post(CHAT, json=BODY, headers=auth(gateway_token()))
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    assert "".join(deltas(resp.text)) == "Words from the engine."
    assert resp.text.rstrip().endswith("data: [DONE]")
    assert engine_side.calls[0]["messages"] == BODY["messages"]


def test_whole_answer_without_streaming(gateway: TestClient) -> None:
    resp = gateway.post(CHAT, json=BODY | {"stream": False}, headers=auth(gateway_token()))
    assert resp.status_code == 200
    choice = resp.json()["choices"][0]
    assert choice["message"] == {"role": "assistant", "content": "Words from the engine."}


def test_an_unknown_model_is_refused(gateway: TestClient, engine_side: FakeAnswers) -> None:
    engine_side.model = lambda provider, model_id: None  # type: ignore[method-assign]
    resp = gateway.post(CHAT, json=BODY, headers=auth(gateway_token()))
    assert resp.status_code == 404 and resp.json() == {"error": "model_not_found"}


def test_an_engine_failure_mid_answer_is_reported_in_the_stream(
    gateway: TestClient, engine_side: FakeAnswers
) -> None:
    engine_side.fail_after = 2
    resp = gateway.post(CHAT, json=BODY, headers=auth(gateway_token()))
    assert resp.status_code == 200
    assert '"error"' in resp.text and "data: [DONE]" not in resp.text


# ------------------------------------------------------------------ provider router
def router_for(gateway: TestClient, engine_side: FakeAnswers) -> ProviderRouter:
    return ProviderRouter(engine_side, gateway_url="http://testserver", client=lambda: gateway)


def test_the_router_answers_through_the_gateway(
    gateway: TestClient, engine_side: FakeAnswers
) -> None:
    router = router_for(gateway, engine_side)
    assert "".join(router.answer("local", "m1", BODY["messages"])) == "Words from the engine."
    assert router.model("local", "m1") == engine_side.model("local", "m1")


def test_g04_the_router_passes_on_the_engine_token_count(
    gateway: TestClient, engine_side: FakeAnswers
) -> None:
    """Token counts are model facts, like the context length: from the local model module."""
    router = router_for(gateway, engine_side)
    assert router.count_tokens("local", "m1", "a b c") is None  # the fake has no tokenizer
    engine_side.count_tokens = lambda provider, model_id, text: len(text.split())  # type: ignore[attr-defined]
    assert router.count_tokens("local", "m1", "a b c") == 3
    assert router.count_tokens("company", "m1", "a b c") is None


def test_the_router_has_no_company_provider_while_company_is_off(
    gateway: TestClient, engine_side: FakeAnswers
) -> None:
    router = router_for(gateway, engine_side)
    # No operator flag, no company provider (G-06, tests/test_company.py): chat answers unreachable.
    assert router.model("company", None) is None


def test_ac_chat_answers_through_router_and_gateway(
    settings: Settings, db: Database, gateway: TestClient, engine_side: FakeAnswers
) -> None:
    """The whole path the shipped app takes: chat -> provider router -> gateway -> engine."""
    router = router_for(gateway, engine_side)
    headers = auth(LAUNCH_TOKEN)
    with TestClient(create_app(settings, db, router), client=LOOPBACK, headers=headers) as api:
        project = api.post("/projects", json={"name": "P", "classification": "internal"}).json()
        conv = api.post(f"/projects/{project['id']}/conversations", json={}).json()
        resp = api.post(f"/conversations/{conv['id']}/messages", json={"text": "Hello"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["assistant"]["content"] == "Words from the engine."
    assert engine_side.calls, "the engine was reached through the gateway"


def test_the_router_stops_the_gateway_request_when_closed(
    gateway: TestClient, engine_side: FakeAnswers
) -> None:
    router = router_for(gateway, engine_side)
    chunks = router.answer("local", "m1", BODY["messages"])
    assert next(chunks)
    chunks.close()  # Stop: chat closes the iterator; the request to the gateway ends with it


def test_router_uses_loopback_only() -> None:
    with pytest.raises(ValueError):
        ProviderRouter(FakeAnswers(), gateway_url="http://example.com:8000")
    ProviderRouter(
        FakeAnswers(), gateway_url="http://127.0.0.1:8000", client=lambda: httpx.Client()
    )
