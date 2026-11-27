"""Cloud AI providers with several models (Claude, ChatGPT, Mistral, Perplexity).

One key per provider, linked on the Resources page; the person picks the model per conversation
(Claude Opus or Haiku, GPT-6.2 Astra or Sol, ...), every send is allowed once, and tokens and cost
are counted per model, each at its own price. Claude is answered over Anthropic's Messages API
(``x-api-key``), the others over the OpenAI-compatible protocol.
"""

import json
from collections.abc import Iterator

import httpx
import pytest
from fastapi.testclient import TestClient
from tests.conftest import FakeAnswers

from aios_backend import company, linked, linked_config
from aios_backend.apps.resources import service as resource_service
from db.session import Database

KEY = "sk-ant-" + "a" * 32
OPUS, FABLE, HAIKU = "claude-opus-5-5", "claude-fable-5-2", "claude-haiku-5-5"


@pytest.fixture
def keystore(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    store: dict[str, str] = {}
    monkeypatch.setattr(linked_config, "get_secret", store.get)
    monkeypatch.setattr(linked_config, "set_secret", store.__setitem__)
    monkeypatch.setattr(linked_config, "delete_secret", store.pop)
    return store


@pytest.fixture
def resources(chat: TestClient, keystore: dict[str, str]) -> Iterator[TestClient]:
    chat.app.state.resource_check = lambda rid, key: None  # type: ignore[attr-defined]
    chat.app.state.resource_models = None  # type: ignore[attr-defined]  # no network in tests
    yield chat


def _conversation(api: TestClient) -> str:
    project = api.post("/projects", json={"name": "P", "classification": "internal"}).json()
    return str(api.post(f"/projects/{project['id']}/conversations", json={}).json()["id"])


# ------------------------------------------------------------------ Claude's Messages API
class Anthropic:
    """api.anthropic.com as an httpx transport."""

    def __init__(self, models: tuple[str, ...] = (OPUS, FABLE, HAIKU)) -> None:
        self.models = models
        self.requests: list[httpx.Request] = []
        self.stop = "end_turn"

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.headers.get("x-api-key") != KEY or "authorization" in request.headers:
            return httpx.Response(401)
        if request.headers.get("anthropic-version") != linked.ANTHROPIC_VERSION:
            return httpx.Response(400)
        if request.url.path == "/v1/models":
            return httpx.Response(200, json={"data": [{"id": m} for m in self.models]})
        if request.url.path == "/v1/messages":
            events = [
                {
                    "type": "message_start",
                    "message": {
                        "usage": {
                            "input_tokens": 12,
                            "cache_read_input_tokens": 3,
                            "output_tokens": 1,
                        }
                    },
                },
                {"type": "content_block_start", "index": 0, "content_block": {"type": "thinking"}},
                {
                    "type": "content_block_delta",
                    "index": 0,
                    "delta": {"type": "thinking_delta", "thinking": ""},
                },
                {
                    "type": "content_block_delta",
                    "index": 1,
                    "delta": {"type": "text_delta", "text": "Hi"},
                },
                {
                    "type": "content_block_delta",
                    "index": 1,
                    "delta": {"type": "text_delta", "text": " there"},
                },
                {
                    "type": "message_delta",
                    "delta": {"stop_reason": self.stop},
                    "usage": {"output_tokens": 5},
                },
                {"type": "message_stop"},
            ]
            body = "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events)
            return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})
        return httpx.Response(404)


def _claude(keystore: dict[str, str], server: Anthropic) -> linked.LinkedResources:
    keystore[linked_config.key_name("claude")] = KEY
    return linked.LinkedResources(transport=httpx.MockTransport(server.handler))


MESSAGES = [
    {"role": "system", "content": "Be brief."},
    {"role": "user", "content": "Hello"},
]


def test_claude_answers_over_the_messages_api_with_its_own_key_header(
    keystore: dict[str, str],
) -> None:
    server = Anthropic()
    side = _claude(keystore, server)
    info = side.model("resource", OPUS)
    assert info is not None and info.model_id == OPUS
    out = side.answer("resource", OPUS, MESSAGES)
    assert "".join(out) == "Hi there"  # thinking blocks are not shown
    assert out.usage == (15, 5)  # every input token billed, cache reads included
    sent = server.requests[-1]
    assert str(sent.url) == "https://api.anthropic.com/v1/messages"
    body = json.loads(sent.content)
    assert body["model"] == OPUS and body["stream"] is True
    assert body["system"].endswith("Be brief.")  # system prompts go in "system"
    assert all(m["role"] in ("user", "assistant") for m in body["messages"])
    assert body["messages"][-1] == {"role": "user", "content": "Hello"}
    assert "temperature" not in body
    assert body["fallbacks"] == "default"
    assert sent.headers["anthropic-beta"] == linked.CLAUDE_FALLBACK_BETA


def test_each_claude_model_is_answered_as_itself(keystore: dict[str, str]) -> None:
    server = Anthropic()
    side = _claude(keystore, server)
    "".join(side.answer("resource", HAIKU, MESSAGES))
    body = json.loads(server.requests[-1].content)
    assert body["model"] == HAIKU and "fallbacks" not in body
    "".join(side.answer("resource", FABLE, MESSAGES))
    assert json.loads(server.requests[-1].content)["model"] == FABLE


def test_a_model_the_key_cannot_use_is_unavailable(keystore: dict[str, str]) -> None:
    side = _claude(keystore, Anthropic(models=(HAIKU,)))
    assert side.model("resource", HAIKU) is not None
    assert side.model("resource", OPUS) is None


def test_a_declined_claude_answer_says_so(keystore: dict[str, str]) -> None:
    server = Anthropic()
    server.stop = "refusal"
    side = _claude(keystore, server)
    with pytest.raises(company.CompanyError) as exc:
        "".join(side.answer("resource", OPUS, MESSAGES))
    assert exc.value.code == "resource_answer_refused"


def test_the_claude_key_check(keystore: dict[str, str]) -> None:
    transport = httpx.MockTransport(Anthropic(models=(HAIKU, "claude-other")).handler)
    assert linked.check("claude", KEY, transport=transport) is None  # one model is enough
    assert linked.check("claude", "sk-ant-" + "b" * 32, transport=transport) == (
        "resource_key_rejected"
    )
    none = httpx.MockTransport(Anthropic(models=("text-embedding-x",)).handler)
    assert linked.check("claude", KEY, transport=none) == "resource_model_not_listed"
    assert linked.listed_models("claude", KEY, transport=transport) == [
        "claude-haiku-5-5",
        "claude-other",
    ]


# ------------------------------------------------------------------ OpenAI-compatible providers
def _openai_body(rid: str, model: str, keystore: dict[str, str]) -> dict[str, object]:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        assert request.headers["authorization"] == f"Bearer {KEY}"
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": model}]})
        chunk = {"choices": [{"delta": {"content": "ok"}}]}
        body = f"data: {json.dumps(chunk)}\n\ndata: [DONE]\n\n"
        return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})

    keystore[linked_config.key_name(rid)] = KEY
    side = linked.LinkedResources(transport=httpx.MockTransport(handler))
    assert "".join(side.answer("resource", model, MESSAGES)) == "ok"
    return dict(json.loads(seen[-1].content), _url=str(seen[-1].url))


def test_chatgpt_mistral_and_perplexity_are_asked_for_the_picked_model(
    keystore: dict[str, str],
) -> None:
    gpt = _openai_body("chatgpt", "gpt-6.2-astra", keystore)
    assert gpt["model"] == "gpt-6.2-astra" and "stream_options" in gpt
    assert gpt["_url"] == "https://api.openai.com/v1/chat/completions"
    mistral = _openai_body("mistral", "mistral-medium-latest", keystore)
    assert mistral["model"] == "mistral-medium-latest" and "stream_options" not in mistral
    pplx = _openai_body("perplexity", "perplexity/sonar", keystore)
    assert pplx["_url"] == "https://api.perplexity.ai/orchestrator/v1/chat/completions"


# ------------------------------------------------------------------ picking a model
def test_the_person_picks_the_model(resources: TestClient, answers: FakeAnswers) -> None:
    conv = _conversation(resources)
    resources.post("/resources/claude/link", json={"api_key": KEY})
    move = f"/conversations/{conv}/provider"
    moved = resources.post(
        move, json={"to": "resource", "resource_id": "claude", "model_id": FABLE, "confirmed": True}
    )
    assert moved.status_code == 200 and moved.json()["model_id"] == FABLE
    resources.post(f"/conversations/{conv}/messages", json={"text": "Hi", "allowed": True})
    assert answers.calls[-1]["model_id"] == FABLE

    # another model of the same provider asks again; the same one changes nothing
    unasked = resources.post(
        move, json={"to": "resource", "resource_id": "claude", "model_id": HAIKU}
    )
    assert unasked.status_code == 400 and unasked.json()["error"] == "confirmation_required"
    same = resources.post(move, json={"to": "resource", "resource_id": "claude", "model_id": FABLE})
    assert same.status_code == 200
    switched = resources.post(
        move, json={"to": "resource", "resource_id": "claude", "model_id": HAIKU, "confirmed": True}
    )
    assert switched.json()["model_id"] == HAIKU
    unknown = resources.post(
        move,
        json={
            "to": "resource",
            "resource_id": "claude",
            "model_id": "gpt-6.2-sol",
            "confirmed": True,
        },
    )
    assert unknown.status_code == 400 and unknown.json()["error"] == "resource_model_unknown"


def test_without_a_model_the_default_one_is_used(resources: TestClient) -> None:
    conv = _conversation(resources)
    resources.post("/resources/chatgpt/link", json={"api_key": KEY})
    moved = resources.post(
        f"/conversations/{conv}/provider",
        json={"to": "resource", "resource_id": "chatgpt", "confirmed": True},
    )
    assert moved.json()["model_id"] == linked_config.model_ids("chatgpt")[0]


def test_the_resource_lists_its_models(resources: TestClient) -> None:
    resources.post("/resources/claude/link", json={"api_key": KEY})
    row = resources.get("/resources").json()[0]
    assert [m["id"] for m in row["models"]] == linked_config.model_ids("claude")
    assert row["model_id"] == OPUS
    assert {m["name"] for m in row["models"]} >= {"Claude Opus 5.5", "Claude Fable 5.2"}


# ------------------------------------------------------------------ usage and price per model
def _send(api: TestClient, conv: str, model: str) -> None:
    api.post(
        f"/conversations/{conv}/provider",
        json={"to": "resource", "resource_id": "claude", "model_id": model, "confirmed": True},
    )
    assert (
        api.post(
            f"/conversations/{conv}/messages", json={"text": "Hello", "allowed": True}
        ).status_code
        == 200
    )


def test_tokens_and_cost_are_counted_per_model_at_its_own_price(
    resources: TestClient, db: Database
) -> None:
    resources.post("/resources/claude/link", json={"api_key": KEY})
    with db.session() as session:
        resource_service.set_price(session, "claude", 1.0, 2.0)  # the resource's price
        resource_service.set_price(session, "claude", 8.0, 40.0, model_id=FABLE)
        session.commit()
    conv = _conversation(resources)
    _send(resources, conv, FABLE)
    _send(resources, conv, HAIKU)
    row = resources.get("/resources").json()[0]
    by_id = {m["id"]: m for m in row["models"]}
    fable, haiku = by_id[FABLE], by_id[HAIKU]
    assert fable["uses"] == 1 and haiku["uses"] == 1 and by_id[OPUS]["uses"] == 0
    assert (fable["price_in"], fable["price_out"]) == (8.0, 40.0)
    assert (haiku["price_in"], haiku["price_out"]) == (1.0, 2.0)  # no own price: the resource's
    assert fable["spent"] == pytest.approx(
        (fable["tokens_in"] * 8.0 + fable["tokens_out"] * 40.0) / 1_000_000
    )
    assert row["spent"] == pytest.approx(fable["spent"] + haiku["spent"])
    assert row["tokens_in"] == fable["tokens_in"] + haiku["tokens_in"]
    assert row["uses"] == 2


def test_a_price_for_an_unknown_model_is_refused(resources: TestClient, db: Database) -> None:
    resources.post("/resources/claude/link", json={"api_key": KEY})
    with db.session() as session, pytest.raises(Exception) as exc:
        resource_service.set_price(session, "claude", 1.0, 1.0, model_id="gpt-6.2-sol")
    assert getattr(exc.value, "code", None) == "resource_model_unknown"


def test_the_monthly_limit_counts_every_model(resources: TestClient, db: Database) -> None:
    resources.post("/resources/claude/link", json={"api_key": KEY, "monthly_limit": 0.000001})
    with db.session() as session:
        resource_service.set_price(session, "claude", 10.0, 10.0, model_id=FABLE)
        session.commit()
    conv = _conversation(resources)
    _send(resources, conv, FABLE)
    resources.post(
        f"/conversations/{conv}/provider",
        json={"to": "resource", "resource_id": "claude", "model_id": HAIKU, "confirmed": True},
    )
    blocked = resources.post(
        f"/conversations/{conv}/messages", json={"text": "Hi", "allowed": True}
    )
    assert blocked.status_code == 409 and blocked.json()["error"] == "resource_limit_reached"


# ------------------------------------------------------------------ every model the key can use
@pytest.fixture
def listed() -> Iterator[None]:
    yield
    for rid in linked_config.SPECS:
        linked_config.set_listed(rid, None)


def test_every_chat_model_the_key_lists_is_offered(
    resources: TestClient, listed: None, answers: FakeAnswers
) -> None:
    key_models = ["claude-opus-4-8", OPUS, "claude-sonnet-4-6", HAIKU]
    resources.app.state.resource_models = lambda rid, key: key_models  # type: ignore[attr-defined]
    resources.post("/resources/claude/link", json={"api_key": KEY})
    row = resources.get("/resources").json()[0]
    # AIOS's preferred models the key has come first (the default first), then the rest
    assert [m["id"] for m in row["models"]] == [OPUS, HAIKU, "claude-opus-4-8", "claude-sonnet-4-6"]
    assert row["model_id"] == OPUS
    conv = _conversation(resources)
    moved = resources.post(
        f"/conversations/{conv}/provider",
        json={
            "to": "resource",
            "resource_id": "claude",
            "model_id": "claude-opus-4-8",
            "confirmed": True,
        },
    )
    assert moved.status_code == 200 and moved.json()["model_id"] == "claude-opus-4-8"
    resources.post(f"/conversations/{conv}/messages", json={"text": "Hi", "allowed": True})
    assert answers.calls[-1]["model_id"] == "claude-opus-4-8"
    # a model this key cannot use (fable) is not offered
    refused = resources.post(
        f"/conversations/{conv}/provider",
        json={"to": "resource", "resource_id": "claude", "model_id": FABLE, "confirmed": True},
    )
    assert refused.status_code == 400 and refused.json()["error"] == "resource_model_unknown"


def test_the_model_list_is_remembered_after_a_restart(
    resources: TestClient, listed: None, db: Database
) -> None:
    resources.app.state.resource_models = lambda rid, key: ["gpt-5.5", "gpt-6.2-sol"]  # type: ignore[attr-defined]
    resources.post("/resources/chatgpt/link", json={"api_key": KEY})
    linked_config.set_listed("chatgpt", None)  # as after a restart
    with db.session() as session:
        resource_service.remember_models(session)
    assert linked_config.model_ids("chatgpt") == ["gpt-6.2-sol", "gpt-5.5"]
    assert linked_config.resource_for("gpt-5.5") == "chatgpt"


def test_only_chat_models_are_offered(keystore: dict[str, str]) -> None:
    listed_ids = [
        "gpt-6.2-sol",
        "gpt-5-pro",
        "gpt-image-2",
        "gpt-4o-mini-tts",
        "text-embedding-3-large",
        "whisper-1",
        "gpt-realtime",
        "o3",
        "omni-moderation-latest",
        "gpt-5.3-codex",
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        assert "limit" not in request.url.params  # only Anthropic pages its list
        return httpx.Response(200, json={"data": [{"id": m} for m in listed_ids]})

    found = linked.chat_models("chatgpt", KEY, transport=httpx.MockTransport(handler))
    assert found == ["gpt-6.2-sol", "o3"]


def test_mistral_says_which_models_chat(keystore: dict[str, str]) -> None:
    entries = [
        {"id": "mistral-large-latest", "capabilities": {"completion_chat": True}},
        {"id": "mistral-embed", "capabilities": {"completion_chat": False}},
        {"id": "codestral-latest", "capabilities": {"completion_chat": True}},
    ]
    transport = httpx.MockTransport(lambda r: httpx.Response(200, json={"data": entries}))
    assert linked.chat_models("mistral", KEY, transport=transport) == [
        "codestral-latest",
        "mistral-large-latest",
    ]
