"""The Company provider (G-06): an OpenAI-compatible server reached through the gateway.

A Company server is any OpenAI-compatible endpoint the operator configures: a lab GPU host, or a
hosted API such as DeepSeek. The request still goes provider router -> gateway (invariant 1);
the gateway's company side sends it through the allowlisted outbound client (SR-01), with the
key read from the OS key store at request time (FR-30). The key is never in a file, the
settings, the evidence or a log.
"""

import json
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from tests.conftest import LOOPBACK, FakeAnswers

from aios_backend import cli, company
from aios_backend.company import CompanyConfig, CompanyProvider
from aios_backend.config import Settings
from aios_backend.engine.launcher import EngineError
from aios_backend.gateway.app import GATEWAY_PURPOSE, create_gateway_app
from aios_backend.providers import ProviderRouter
from aios_common.handshake import derive
from db.session import Database

KEY = "sk-test-not-a-real-key-0000000000"
CONFIG = CompanyConfig(base_url="https://api.example-ai.com", model_name="example-chat")
HELLO = [{"role": "user", "content": "Hello"}]


def sse(*texts: str, usage: bool = False) -> bytes:
    lines = []
    for t in texts:
        lines.append("data: " + json.dumps({"choices": [{"index": 0, "delta": {"content": t}}]}))
    if usage:
        lines.append("data: " + json.dumps({"choices": [], "usage": {"prompt_tokens": 3}}))
    lines.append("data: [DONE]")
    return ("\n\n".join(lines) + "\n\n").encode()


class Server:
    """A fake OpenAI-compatible server that records what it was sent."""

    def __init__(self, status: int = 200, body: bytes | None = None) -> None:
        self.status = status
        self.body = body if body is not None else sse("Hi", " there.")
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.method == "GET" and request.url.path.endswith("/models"):
            # The provider checks the server lists the model before offering it (G-06).
            return httpx.Response(self.status, json={"data": [{"id": CONFIG.model_name}]})
        return httpx.Response(self.status, content=self.body)


def provider(
    server: Server, key: str | None = KEY, config: CompanyConfig = CONFIG
) -> CompanyProvider:
    return CompanyProvider(config, secret=lambda: key, transport=httpx.MockTransport(server))


# ------------------------------------------------------------------ configuration
def test_g06_no_file_means_no_company_provider(tmp_path: Path) -> None:
    assert company.load_config(tmp_path / "company.json") is None


def test_g06_config_file_round_trip_holds_no_key(tmp_path: Path) -> None:
    path = tmp_path / "company.json"
    company.save_config(path, CONFIG)
    assert company.load_config(path) == CONFIG
    text = path.read_text(encoding="utf-8")
    assert "key" not in text.lower() and KEY not in text


@pytest.mark.parametrize(
    "content",
    [
        "not json",
        json.dumps({"base_url": "http://plain.example.com", "model_name": "m"}),  # HTTPS only
        json.dumps({"base_url": "https://user:pw@x.example.com", "model_name": "m"}),
        json.dumps({"base_url": "https://x.example.com"}),
        json.dumps({"base_url": "https://x.example.com", "model_name": ""}),
    ],
)
def test_g06_a_bad_config_turns_the_provider_off(tmp_path: Path, content: str) -> None:
    path = tmp_path / "company.json"
    path.write_text(content, encoding="utf-8")
    assert company.load_config(path) is None


def test_g06_settings_turn_the_flag_on_from_the_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from aios_backend import config

    path = tmp_path / "company.json"
    company.save_config(path, CONFIG)
    settings = config.with_company(config.load(config.Profile.TEST), path)
    assert settings.company_ai is True
    assert settings.company_base_url == CONFIG.base_url
    assert settings.company_model_name == CONFIG.model_name
    off = config.with_company(config.load(config.Profile.TEST), tmp_path / "missing.json")
    assert off.company_ai is False and off.company_base_url is None


# ------------------------------------------------------------------ the provider itself
def test_g06_model_needs_a_key_in_the_key_store() -> None:
    info = provider(Server()).model("company", None)
    assert info is not None and info.model_id == "example-chat"
    assert info.context_length == CONFIG.context_length
    assert provider(Server(), key=None).model("company", None) is None
    assert provider(Server()).model("local", None) is None


def test_g06_answer_streams_from_the_server_with_the_key() -> None:
    server = Server(body=sse("Hi", " there.", usage=True))
    assert "".join(provider(server).answer("company", "example-chat", HELLO)) == "Hi there."
    (request,) = server.requests
    # An address without a path gets /v1, as every OpenAI-compatible server serves it.
    assert str(request.url) == "https://api.example-ai.com/v1/chat/completions"
    assert request.headers["authorization"] == f"Bearer {KEY}"
    body = json.loads(request.content)
    assert body["model"] == "example-chat" and body["stream"] is True
    # The AIOS prompt goes first, as for the local model; then the conversation.
    assert body["messages"][0]["role"] == "system"
    assert body["messages"][1:] == HELLO


def test_g06_a_base_url_with_a_path_keeps_it() -> None:
    server = Server()
    cfg = CompanyConfig(base_url="https://gpu.example.com/v1/", model_name="m")
    "".join(provider(server, config=cfg).answer("company", "m", HELLO))
    assert str(server.requests[0].url) == "https://gpu.example.com/v1/chat/completions"


@pytest.mark.parametrize("status", [401, 402, 429, 500])
def test_g06_a_refused_request_is_an_engine_error(status: int) -> None:
    with pytest.raises(EngineError):
        "".join(provider(Server(status=status, body=b"{}")).answer("company", "m", HELLO))


def test_g06_an_error_in_the_stream_is_an_engine_error() -> None:
    body = b'data: {"error": {"message": "overloaded"}}\n\n'
    with pytest.raises(EngineError):
        "".join(provider(Server(body=body)).answer("company", "m", HELLO))


def test_g06_without_a_key_nothing_is_sent() -> None:
    server = Server()
    with pytest.raises(EngineError):
        "".join(provider(server, key=None).answer("company", "m", HELLO))
    assert server.requests == []


def test_g06_the_request_goes_through_the_allowlist() -> None:
    """The outbound client checks every request; a host other than the configured one is refused."""
    server_redirect = Server()

    def redirect(request: httpx.Request) -> httpx.Response:
        if request.url.host == "api.example-ai.com":
            return httpx.Response(302, headers={"location": "https://evil.example.net/x"})
        return server_redirect(request)

    p = CompanyProvider(CONFIG, secret=lambda: KEY, transport=httpx.MockTransport(redirect))
    with pytest.raises(EngineError):
        "".join(p.answer("company", "m", HELLO))
    assert server_redirect.requests == []


def test_g06_the_key_is_never_logged(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level("DEBUG")
    "".join(provider(Server()).answer("company", "m", HELLO))
    with pytest.raises(EngineError):
        "".join(provider(Server(status=401, body=b"{}")).answer("company", "m", HELLO))
    assert KEY not in caplog.text and "Hello" not in caplog.text


# ------------------------------------------------------------------ router -> gateway -> company
@pytest.fixture
def company_side() -> FakeAnswers:
    return FakeAnswers("Words from the company server.")


@pytest.fixture
def gateway(company_side: FakeAnswers) -> Iterator[TestClient]:
    app = create_gateway_app(FakeAnswers("Words from the engine."), company_side)
    with TestClient(app, client=LOOPBACK) as c:
        yield c


def test_g06_the_gateway_sends_company_requests_to_the_company_side(
    gateway: TestClient, company_side: FakeAnswers
) -> None:
    body = {"model": "example-chat", "messages": HELLO, "stream": True, "provider": "company"}
    resp = gateway.post(
        "/v1/chat/completions",
        json=body,
        headers={"Authorization": f"Bearer {derive(GATEWAY_PURPOSE)}"},
    )
    assert resp.status_code == 200
    text = "".join(
        json.loads(line[6:])["choices"][0]["delta"].get("content", "")
        for line in resp.text.splitlines()
        if line.startswith("data: ") and line != "data: [DONE]"
    )
    assert text == "Words from the company server."
    assert company_side.calls[0]["provider"] == "company"


def test_g06_the_gateway_without_a_company_side_answers_404() -> None:
    app = create_gateway_app(FakeAnswers())
    body = {"model": "m", "messages": HELLO, "provider": "company"}
    with TestClient(app, client=LOOPBACK) as c:
        resp = c.post(
            "/v1/chat/completions",
            json=body,
            headers={"Authorization": f"Bearer {derive(GATEWAY_PURPOSE)}"},
        )
    assert resp.status_code == 404


def test_g06_the_router_answers_company_through_the_gateway(
    gateway: TestClient, company_side: FakeAnswers
) -> None:
    router = ProviderRouter(
        FakeAnswers(), gateway_url="http://testserver", client=lambda: gateway, company=company_side
    )
    assert router.model("company", None) == company_side.model("company", None)
    text = "".join(router.answer("company", "example-chat", HELLO))
    assert text == "Words from the company server."
    assert company_side.calls, "the company side was reached through the gateway"


# ------------------------------------------------------------------ where the key is entered
def test_g06_cli_stores_the_key_in_the_key_store_only(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    stored: dict[str, str] = {}
    path = tmp_path / "company.json"
    monkeypatch.setattr(company, "set_secret", lambda name, value: stored.__setitem__(name, value))
    monkeypatch.setattr(cli, "_company_file", lambda profile: path)
    monkeypatch.setattr(cli.getpass, "getpass", lambda prompt="": KEY)
    code = cli.main(
        [
            "company",
            "set",
            "--url",
            "https://api.example-ai.com",
            "--model",
            "example-chat",
            "--no-check",
        ]
    )
    assert code == 0
    assert stored == {company.KEY_NAME: KEY}
    assert company.load_config(path) == CONFIG
    assert KEY not in path.read_text(encoding="utf-8")


def test_g06_cli_refuses_an_empty_key(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "company.json"
    monkeypatch.setattr(company, "set_secret", lambda name, value: pytest.fail("stored"))
    monkeypatch.setattr(cli, "_company_file", lambda profile: path)
    monkeypatch.setattr(cli.getpass, "getpass", lambda prompt="": "  ")
    assert cli.main(["company", "set", "--url", "https://a.example.com", "--model", "m"]) != 0
    assert not path.exists()


def test_g06_cli_clear_removes_file_and_key(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    deleted: list[str] = []
    path = tmp_path / "company.json"
    company.save_config(path, CONFIG)
    monkeypatch.setattr(company, "delete_secret", deleted.append)
    monkeypatch.setattr(cli, "_company_file", lambda profile: path)
    assert cli.main(["company", "clear"]) == 0
    assert not path.exists() and deleted == [company.KEY_NAME]


# ------------------------------------------------------------------ live: no restart needed
def test_g06_cli_set_defaults_to_deepseek(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Only the key is asked for: ``aios-backend company set`` alone sets up DeepSeek."""
    path = tmp_path / "company.json"
    monkeypatch.setattr(company, "set_secret", lambda name, value: None)
    monkeypatch.setattr(cli, "_company_file", lambda profile: path)
    monkeypatch.setattr(cli.getpass, "getpass", lambda prompt="": KEY)
    assert cli.main(["company", "set", "--no-check"]) == 0
    found = company.load_config(path)
    assert found is not None
    assert found.base_url == "https://api.deepseek.com" and found.model_name == "deepseek-chat"


def test_g06_the_company_side_picks_up_a_new_file_while_running(tmp_path: Path) -> None:
    path = tmp_path / "company.json"
    server = Server()
    side = company.ConfiguredCompany(
        path, secret=lambda: KEY, transport=httpx.MockTransport(server)
    )
    assert side.model("company", None) is None  # nothing configured yet
    company.save_config(path, CONFIG)
    info = side.model("company", None)
    assert info is not None and info.model_id == "example-chat"
    assert "".join(side.answer("company", "example-chat", HELLO)) == "Hi there."
    path.unlink()
    assert side.model("company", None) is None
    with pytest.raises(EngineError):
        "".join(side.answer("company", "example-chat", HELLO))


def test_g06_settings_follow_the_file_without_a_restart(
    settings: Settings, db: Database, tmp_path: Path
) -> None:
    import dataclasses

    from tests.conftest import LAUNCH_TOKEN

    from aios_backend.main import create_app

    path = tmp_path / "company.json"
    live = dataclasses.replace(settings, company_file=path)
    headers = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}
    with TestClient(create_app(live, db, FakeAnswers()), client=LOOPBACK, headers=headers) as api:
        assert api.get("/system/status").json()["company"]["enabled"] is False
        company.save_config(path, CONFIG)
        status = api.get("/system/status").json()["company"]
        assert status["enabled"] is True and status["base_url"] == CONFIG.base_url
        path.unlink()
        assert api.get("/system/status").json()["company"]["enabled"] is False
