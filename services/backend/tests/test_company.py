"""G-06: the Company provider. AIOS answers from the company's AI server (an OpenAI-compatible
server such as llama-server on the lab GPU host), only while an operator has switched it on.

The path stays chat -> provider router -> gateway -> provider (invariant 1, PR-04). The server's API
key lives only in the OS key store (invariant 3) and never reaches a log, a file or a response.
Every request goes through the network door, which allows only the one configured host (M-22, P-4).
"""

import dataclasses
import io
import json
import logging
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from tests.conftest import LAUNCH_TOKEN, LOOPBACK, FakeAnswers

from aios_backend import cli, company, config
from aios_backend.apps.chat.answers import ModelInfo
from aios_backend.company import KEY_NAME, SYSTEM_PROMPT, CompanyError, CompanyModels
from aios_backend.config import Profile, Settings
from aios_backend.gateway.app import GATEWAY_PURPOSE, create_gateway_app
from aios_backend.main import create_app
from aios_backend.providers import ProviderRouter
from aios_common.handshake import derive
from db.session import Database

BASE = "https://ai.company.test"
MODEL = "gemma-4-26b-a4b"
KEY = "0123456789abcdef" * 4
CHAT = "/v1/chat/completions"
HELLO = [{"role": "user", "content": "Hello"}]


@pytest.fixture
def company_settings(settings: Settings) -> Settings:
    return dataclasses.replace(
        settings,
        company_ai=True,
        company_base_url=BASE,
        company_model_name=MODEL,
        company_context_tokens=16384,
    )


class FakeServer:
    """The company's model server as an httpx transport. Records every request it receives."""

    def __init__(self, text: str = "Words from the company server.") -> None:
        self.text = text
        self.models = [MODEL]
        self.status = 200
        self.fail_after: int | None = None
        self.redirect: str | None = None
        self.unreachable = False
        self.requests: list[httpx.Request] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.unreachable:
            raise httpx.ConnectError("no route", request=request)
        if self.redirect:
            return httpx.Response(302, headers={"location": self.redirect})
        if request.headers.get("authorization") != f"Bearer {KEY}" or self.status == 401:
            return httpx.Response(401, json={"error": {"code": 401, "message": "Invalid API Key"}})
        if self.status != 200:
            return httpx.Response(self.status)
        if request.method == "GET" and request.url.path == "/v1/models":
            return httpx.Response(
                200, json={"object": "list", "data": [{"id": m} for m in self.models]}
            )
        if request.method == "POST" and request.url.path == CHAT:
            return httpx.Response(
                200, headers={"content-type": "text/event-stream"}, content=self._stream()
            )
        return httpx.Response(404)

    def _stream(self) -> Iterator[bytes]:
        def event(body: dict[str, object]) -> bytes:
            return f"data: {json.dumps(body)}\n\n".encode()

        for i, word in enumerate(self.text.split(" ")):
            if self.fail_after is not None and i >= self.fail_after:
                raise httpx.ReadError("dropped")
            piece = word if i == 0 else " " + word
            yield event({"choices": [{"index": 0, "delta": {"content": piece}}]})
        yield event({"choices": [], "usage": {"prompt_tokens": 12, "completion_tokens": 5}})
        yield b"data: [DONE]\n\n"

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def provider(
    settings: Settings, server: FakeServer, key: str | None = KEY, clock: Clock | None = None
) -> CompanyModels:
    return CompanyModels(
        settings, secret=lambda: key, clock=clock or Clock(), transport=server.transport
    )


def gateway_auth() -> dict[str, str]:
    return {"Authorization": f"Bearer {derive(GATEWAY_PURPOSE)}"}


def deltas(body: str) -> list[str]:
    out = []
    for line in body.splitlines():
        if line.startswith("data: ") and line != "data: [DONE]":
            for choice in json.loads(line[6:]).get("choices", []):
                out.append(choice["delta"].get("content", ""))
    return out


def error_codes(caplog: pytest.LogCaptureFixture) -> list[object]:
    return [getattr(r, "fields", {}).get("error_code") for r in caplog.records]


# ------------------------------------------------------------------ the operator file
def write(path: Path, data: object) -> Path:
    path.write_text(data if isinstance(data, str) else json.dumps(data), "utf-8")
    return path


GOOD = {
    "company_ai": True,
    "company_base_url": "https://llm.example.com/",
    "company_model_name": MODEL,
    "company_context_tokens": 16384,
}


def test_g06_the_operator_file_switches_company_on(tmp_path: Path) -> None:
    assert config.company_from_file(write(tmp_path / "operator.json", GOOD)) == {
        "company_ai": True,
        "company_base_url": "https://llm.example.com",
        "company_model_name": MODEL,
        "company_context_tokens": 16384,
    }


def test_g06_the_context_size_has_a_default(tmp_path: Path) -> None:
    data = {k: v for k, v in GOOD.items() if k != "company_context_tokens"}
    found = config.company_from_file(write(tmp_path / "operator.json", data))
    assert found["company_context_tokens"] == config.COMPANY_CONTEXT_TOKENS


def test_g06_without_an_operator_file_company_stays_off(tmp_path: Path) -> None:
    assert config.company_from_file(tmp_path / "missing.json") == {}


@pytest.mark.parametrize(
    "url",
    [
        "http://llm.example.com",  # not HTTPS
        "https://10.0.0.5",  # an IP address, not a DNS name
        "https://[::1]",
        "https://localhost",
        "https://llm.example.com:8443",  # the allowlist allows port 443 only
        "https://user:pw@llm.example.com",  # credentials in the address
        "https://llm.example.com/v1",  # a path: AIOS adds /v1/... itself
        "https://llm.example.com/?x=1",
        "not an address",
    ],
)
def test_g06_an_unsafe_server_address_keeps_company_off(tmp_path: Path, url: str) -> None:
    data = GOOD | {"company_base_url": url}
    assert config.company_from_file(write(tmp_path / "operator.json", data)) == {}


@pytest.mark.parametrize(
    "data",
    [
        "{ not json",
        ["a", "list"],
        GOOD | {"company_ai": False},
        GOOD | {"company_ai": "yes"},
        {k: v for k, v in GOOD.items() if k != "company_model_name"},
        GOOD | {"company_model_name": "two words"},
        # The model id goes into evidence, which refuses "/" (db.outbox).
        GOOD | {"company_model_name": "org/model"},
        GOOD | {"company_context_tokens": 100},
        GOOD | {"company_context_tokens": "16384"},
        # The API key can never live in a file (invariant 3): a file that holds one is refused.
        GOOD | {"api_key": KEY},
    ],
)
def test_g06_a_wrong_operator_file_keeps_company_off(tmp_path: Path, data: object) -> None:
    assert config.company_from_file(write(tmp_path / "operator.json", data)) == {}


def test_g06_the_dev_profile_reads_the_operator_file_from_the_dev_folder(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(config, "DEV_DIR", tmp_path)
    write(tmp_path / config.OPERATOR_FILE, GOOD)
    settings = config.load(Profile.DEV)
    assert settings.company_ai is True
    assert settings.company_base_url == "https://llm.example.com"
    assert settings.company_model_name == MODEL


def test_g06_the_desktop_profile_reads_the_machine_wide_operator_file(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(config.platforms, "require_shipped", lambda: None)
    monkeypatch.setattr(config.paths, "ensure_dirs", lambda: None)
    monkeypatch.setattr(config.paths, "operator_file", lambda: tmp_path / "operator.json")
    write(tmp_path / "operator.json", GOOD)
    assert config.load(Profile.DESKTOP).company_ai is True


def test_g06_the_test_profile_never_reads_an_operator_file() -> None:
    assert config.load(Profile.TEST).company_ai is False


# ------------------------------------------------------------------ is the company model there?
def test_g06_company_off_means_no_model_and_nothing_sent(settings: Settings) -> None:
    server = FakeServer()
    assert provider(settings, server).model("company", None) is None
    assert server.requests == []


def test_g06_without_a_key_nothing_is_sent(company_settings: Settings) -> None:
    server = FakeServer()
    source = provider(company_settings, server, key=None)
    assert source.model("company", None) is None
    assert source.last_error == "company_key_missing"
    assert server.requests == []


def test_g06_the_company_model_when_the_server_answers(company_settings: Settings) -> None:
    server = FakeServer()
    info = provider(company_settings, server).model("company", None)
    assert info == ModelInfo(model_id=MODEL, context_length=16384, runtime="company")
    [request] = server.requests
    assert str(request.url) == f"{BASE}/v1/models"
    assert request.headers["authorization"] == f"Bearer {KEY}"


def test_g06_the_company_provider_never_answers_for_local(company_settings: Settings) -> None:
    assert provider(company_settings, FakeServer()).model("local", None) is None


def test_g06_a_rejected_key_is_logged_without_the_key(
    company_settings: Settings, caplog: pytest.LogCaptureFixture
) -> None:
    server = FakeServer()
    server.status = 401
    source = provider(company_settings, server)
    with caplog.at_level(logging.INFO, logger="aios"):
        assert source.model("company", None) is None
    assert source.last_error == "company_key_rejected"
    assert "company_key_rejected" in error_codes(caplog)
    assert KEY not in caplog.text
    assert all(KEY not in json.dumps(getattr(r, "fields", {})) for r in caplog.records)


def test_g06_a_model_the_server_does_not_list_is_not_offered(company_settings: Settings) -> None:
    server = FakeServer()
    server.models = ["another-model"]
    source = provider(company_settings, server)
    assert source.model("company", None) is None
    assert source.last_error == "company_model_not_listed"


def test_g06_an_unreachable_server(company_settings: Settings) -> None:
    server = FakeServer()
    server.unreachable = True
    source = provider(company_settings, server)
    assert source.model("company", None) is None
    assert source.last_error == "company_unreachable"


def test_g06_the_server_is_reached_only_at_its_configured_address(
    company_settings: Settings,
) -> None:
    server = FakeServer()
    server.redirect = "https://somewhere.else.test/v1/models"
    source = provider(company_settings, server)
    assert source.model("company", None) is None
    assert source.last_error == "company_unreachable"
    assert [r.url.host for r in server.requests] == ["ai.company.test"]  # the hop was refused


def test_g06_the_check_is_cached_briefly(company_settings: Settings) -> None:
    server, clock = FakeServer(), Clock()
    source = provider(company_settings, server, clock=clock)
    assert source.model("company", None) is not None
    assert source.model("company", None) is not None
    assert len(server.requests) == 1
    clock.now += company.OK_TTL_S + 1
    assert source.model("company", None) is not None
    assert len(server.requests) == 2


def test_g06_a_failed_check_is_retried_soon(company_settings: Settings) -> None:
    server, clock = FakeServer(), Clock()
    server.status = 503
    source = provider(company_settings, server, clock=clock)
    assert source.model("company", None) is None
    assert source.model("company", None) is None
    assert len(server.requests) == 1
    server.status = 200  # the admin finished setting the server up
    clock.now += company.FAILED_TTL_S + 1
    assert source.model("company", None) is not None


# ------------------------------------------------------------------ answers
def test_g06_prepare_adds_the_company_prompt_once(company_settings: Settings) -> None:
    source = provider(company_settings, FakeServer())
    once = source.prepare("company", HELLO)
    assert once[0] == {"role": "system", "content": SYSTEM_PROMPT}
    assert source.prepare("company", once) == once
    noted = source.prepare("company", [{"role": "system", "content": "A note."}, *HELLO])
    assert noted[0]["content"] == f"{SYSTEM_PROMPT}\n\nA note."
    assert "on this computer" not in SYSTEM_PROMPT  # the answer does not come from this computer


def test_g06_an_answer_is_streamed_from_the_server(company_settings: Settings) -> None:
    server = FakeServer()
    source = provider(company_settings, server)
    out = source.answer("company", MODEL, source.prepare("company", HELLO))
    assert "".join(out) == "Words from the company server."
    assert out.usage == (12, 5)  # the server's own token counts, not an estimate
    request = server.requests[-1]
    assert str(request.url) == f"{BASE}{CHAT}"
    assert request.headers["authorization"] == f"Bearer {KEY}"
    body = json.loads(request.content)
    assert body["model"] == MODEL and body["stream"] is True
    assert body["messages"][0]["content"] == SYSTEM_PROMPT


def test_g06_thinking_text_never_reaches_the_answer(company_settings: Settings) -> None:
    server = FakeServer("<think>a plan</think>The answer.")
    out = provider(company_settings, server).answer("company", MODEL, HELLO)
    assert "".join(out) == "The answer."


def test_g06_a_rejected_key_while_answering(company_settings: Settings) -> None:
    server = FakeServer()
    server.status = 401
    with pytest.raises(CompanyError) as exc:
        "".join(provider(company_settings, server).answer("company", MODEL, HELLO))
    assert exc.value.code == "company_key_rejected"


def test_g06_a_dropped_connection_keeps_the_words_so_far(company_settings: Settings) -> None:
    server = FakeServer()
    server.fail_after = 2
    got: list[str] = []
    with pytest.raises(CompanyError) as exc:
        for chunk in provider(company_settings, server).answer("company", MODEL, HELLO):
            got.append(chunk)
    assert "".join(got) == "Words from"
    assert exc.value.code == "company_unreachable"


def test_g06_no_answer_while_company_is_off(settings: Settings) -> None:
    server = FakeServer()
    with pytest.raises(CompanyError):
        "".join(provider(settings, server).answer("company", MODEL, HELLO))
    assert server.requests == []


# ------------------------------------------------------------------ gateway and provider router
@pytest.fixture
def server() -> FakeServer:
    return FakeServer()


@pytest.fixture
def local() -> FakeAnswers:
    return FakeAnswers("Words from this computer.")


@pytest.fixture
def gateway(
    company_settings: Settings, server: FakeServer, local: FakeAnswers
) -> Iterator[TestClient]:
    app = create_gateway_app(local, company=provider(company_settings, server))
    with TestClient(app, client=LOOPBACK) as c:
        yield c


def test_g06_the_gateway_sends_company_models_to_the_company_provider(
    gateway: TestClient, local: FakeAnswers
) -> None:
    body = {"model": f"company/{MODEL}", "messages": HELLO, "stream": True}
    resp = gateway.post(CHAT, json=body, headers=gateway_auth())
    assert resp.status_code == 200
    assert "".join(deltas(resp.text)) == "Words from the company server."
    assert local.calls == []


def test_g06_the_gateway_passes_the_token_counts_on(gateway: TestClient) -> None:
    body = {"model": f"company/{MODEL}", "messages": HELLO, "stream": True}
    resp = gateway.post(CHAT, json=body, headers=gateway_auth())
    usage = [
        json.loads(line[6:])["usage"]
        for line in resp.text.splitlines()
        if line.startswith("data: {") and '"usage"' in line
    ]
    assert usage == [{"prompt_tokens": 12, "completion_tokens": 5}]


def test_g06_local_models_still_go_to_the_engine(gateway: TestClient, local: FakeAnswers) -> None:
    body = {"model": "m1", "messages": HELLO, "stream": True}
    resp = gateway.post(CHAT, json=body, headers=gateway_auth())
    assert "".join(deltas(resp.text)) == "Words from this computer."
    assert local.calls[0]["provider"] == "local"


def test_g06_without_a_company_provider_the_gateway_refuses_company_models(
    local: FakeAnswers,
) -> None:
    with TestClient(create_gateway_app(local), client=LOOPBACK) as gw:
        body = {"model": f"company/{MODEL}", "messages": HELLO, "stream": True}
        resp = gw.post(CHAT, json=body, headers=gateway_auth())
    assert resp.status_code == 404 and resp.json() == {"error": "model_not_found"}


def router(gateway: TestClient, local: FakeAnswers, source: CompanyModels) -> ProviderRouter:
    return ProviderRouter(local, "http://testserver", client=lambda: gateway, company=source)


def test_g06_the_router_answers_company_through_the_gateway(
    company_settings: Settings, gateway: TestClient, local: FakeAnswers, server: FakeServer
) -> None:
    source = provider(company_settings, server)
    r = router(gateway, local, source)
    info = r.model("company", None)
    assert info is not None and info.model_id == MODEL
    out = r.answer("company", MODEL, HELLO)
    assert "".join(out) == "Words from the company server."
    assert out.usage == (12, 5)


def test_g06_the_router_prepares_messages_like_the_provider_it_routes_to(
    company_settings: Settings, gateway: TestClient, local: FakeAnswers, server: FakeServer
) -> None:
    r = router(gateway, local, provider(company_settings, server))
    assert r.prepare("company", HELLO)[0]["content"] == SYSTEM_PROMPT
    assert r.prepare("local", HELLO) == HELLO  # the fake engine side adds no prompt


def test_g06_a_router_without_company_has_no_company_model(
    gateway: TestClient, local: FakeAnswers
) -> None:
    r = ProviderRouter(local, "http://testserver", client=lambda: gateway)
    assert r.model("company", None) is None


# ------------------------------------------------------------------ the whole path
def test_g06_a_company_conversation_is_answered_by_the_company_server(
    company_settings: Settings,
    db: Database,
    gateway: TestClient,
    local: FakeAnswers,
    server: FakeServer,
) -> None:
    """chat -> provider router -> gateway -> company provider -> the company's server."""
    r = router(gateway, local, provider(company_settings, server))
    headers = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}
    app = create_app(company_settings, db, r)
    with TestClient(app, client=LOOPBACK, headers=headers) as api:
        project = api.post("/projects", json={"name": "P", "classification": "internal"}).json()
        conv = api.post(f"/projects/{project['id']}/conversations", json={}).json()
        moved = api.post(
            f"/conversations/{conv['id']}/provider", json={"to": "company", "confirmed": True}
        )
        assert moved.status_code == 200, moved.text
        resp = api.post(f"/conversations/{conv['id']}/messages", json={"text": "Hello"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["assistant"]["content"] == "Words from the company server."
        status = api.get("/providers/status").json()
        assert status["company_enabled"] is True and status["company"]["reachable"] is True
        assert KEY not in resp.text and KEY not in json.dumps(status)
    assert local.calls == []
    sent = json.loads(server.requests[-1].content)
    assert sent["messages"][0]["content"].startswith(SYSTEM_PROMPT)
    assert sent["messages"][-1] == {"role": "user", "content": "Hello"}


# ------------------------------------------------------------------ operator commands
@pytest.mark.parametrize(
    "piped",
    [KEY + "\n", "﻿" + KEY + "\r\n"],  # the second as Windows PowerShell 5.1 pipes it
    ids=["plain", "powershell-bom"],
)
def test_g06_the_key_command_stores_the_key_in_the_key_store(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], piped: str
) -> None:
    stored: dict[str, str] = {}
    monkeypatch.setattr(company.keystore, "set_secret", lambda n, v: stored.update({n: v}))
    monkeypatch.setattr("sys.stdin", io.StringIO(piped))
    assert cli.main(["company-key"]) == 0
    assert stored == {KEY_NAME: KEY}
    assert KEY not in capsys.readouterr().out


@pytest.mark.parametrize("value", ["", "   ", "short", "has a space in it 0123456789"])
def test_g06_the_key_command_refuses_a_key_that_cannot_be_right(
    monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    stored: dict[str, str] = {}
    monkeypatch.setattr(company.keystore, "set_secret", lambda n, v: stored.update({n: v}))
    monkeypatch.setattr("sys.stdin", io.StringIO(value + "\n"))
    assert cli.main(["company-key"]) == 1
    assert stored == {}


def test_g06_the_check_command_reports_the_server(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    company_settings: Settings,
    server: FakeServer,
) -> None:
    monkeypatch.setattr(cli, "load", lambda profile: company_settings)
    monkeypatch.setattr(
        cli, "company_models", lambda settings: provider(settings, server), raising=False
    )
    assert cli.main(["company-check"]) == 0
    out = capsys.readouterr().out
    assert "reachable" in out and MODEL in out and KEY not in out
