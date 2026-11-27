"""G-08, M-22, AC-21: the backend reaches only the allowlisted hosts, on every hop."""

import httpx
import pytest

from aios_backend import linked_config
from aios_backend.net import ALLOWLIST, Allowlist, HostNotAllowed, outbound_client


def _client(allowlist: Allowlist, handler: httpx.MockTransport) -> httpx.Client:
    return outbound_client(allowlist, transport=handler)


def ok(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, text="ok")


@pytest.mark.parametrize(
    "url", ["https://models.example.eu/a.gguf", "https://updates.example.eu/latest.yml"]
)
def test_ac_21_fixed_hosts_are_reachable(url: str) -> None:
    sent: list[str] = []

    def record(request: httpx.Request) -> httpx.Response:
        sent.append(str(request.url))
        return ok(request)

    with _client(Allowlist(), httpx.MockTransport(record)) as client:
        assert client.get(url).status_code == 200
    assert sent == [url]


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com/",
        "http://models.example.eu/a.gguf",  # not HTTPS
        "https://models.example.eu:8443/a.gguf",  # another port
        "https://user:pass@models.example.eu/a.gguf",  # credentials in the URL
        "https://models.example.eu.evil.test/",  # suffix trick
    ],
)
def test_ac_21_anything_else_is_refused_before_it_is_sent(url: str) -> None:
    sent: list[str] = []

    def record(request: httpx.Request) -> httpx.Response:
        sent.append(str(request.url))
        return ok(request)

    with _client(Allowlist(), httpx.MockTransport(record)) as client, pytest.raises(HostNotAllowed):
        client.get(url)
    assert sent == []


def test_a_redirect_off_the_allowlist_is_refused() -> None:
    sent: list[str] = []

    def redirect(request: httpx.Request) -> httpx.Response:
        sent.append(str(request.url))
        return httpx.Response(302, headers={"location": "https://cdn.elsewhere.test/a.gguf"})

    with (
        _client(Allowlist(), httpx.MockTransport(redirect)) as client,
        pytest.raises(HostNotAllowed),
    ):
        client.get("https://models.example.eu/a.gguf")
    assert sent == ["https://models.example.eu/a.gguf"]  # the second hop was never sent


def test_the_company_server_only_while_the_flag_is_on() -> None:
    configured: list[str | None] = [None]
    allowlist = Allowlist(company=lambda: configured[0])
    with _client(allowlist, httpx.MockTransport(ok)) as client:
        with pytest.raises(HostNotAllowed):
            client.get("https://ai.company.internal/v1/models")
        configured[0] = "https://ai.company.internal"
        assert client.get("https://ai.company.internal/v1/models").status_code == 200
        with pytest.raises(HostNotAllowed):
            client.get("https://other.company.internal/v1/models")


def test_the_proxy_does_not_change_what_is_checked() -> None:
    allowlist = Allowlist()
    assert allowlist.allows("https://models.example.eu/x")
    assert not allowlist.allows("https://proxy.corp.internal:8080/")


def test_the_allowlist_has_the_contract_flows() -> None:
    ids = [flow[0] for flow in ALLOWLIST]
    linked = [i for i in ids if i.startswith("linked-")]  # linked resources come last
    assert ids[:2] == ["model-mirror", "update-feed"] and ids[-1 - len(linked)] == "company-server"
    assert ids[len(ids) - len(linked) :] == linked
    # One row per chat resource, then a video resource's queue host and its file hosts.
    assert linked[: len(linked_config.RESOURCES)] == [
        f"linked-{rid}" for rid in linked_config.RESOURCES
    ]
    assert {linked_config.resource_of_flow(i) for i in linked} == {
        *linked_config.RESOURCES,
        *linked_config.MEDIA,
    }
    end = -1 - len(linked)
    assert all(i.startswith("model-origin") for i in ids[2:end])  # Hugging Face and its CDN hosts
    assert len(set(ids)) == len(ids)
