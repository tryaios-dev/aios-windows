from fastapi.testclient import TestClient

from aios_backend.components import ComponentState
from aios_backend.config import Profile, Settings, load
from aios_backend.main import create_app
from db.session import Database


def test_health_with_token(client: TestClient) -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {
        "backend": "ok",
        "database": "ok",
        "engine": "not_started",
        "evidence_writer": "not_started",
        "version": "0.1.0",
    }


def test_health_reports_component_states(client: TestClient) -> None:
    client.app.state.components.engine = ComponentState.STARTING  # type: ignore[attr-defined]
    assert client.get("/health").json()["engine"] == "starting"


def test_ac_10_request_without_token_is_rejected(anonymous: TestClient) -> None:
    assert anonymous.get("/health").status_code == 401


def test_ac_10_unknown_path_without_token_reveals_nothing(anonymous: TestClient) -> None:
    assert anonymous.get("/does-not-exist").status_code == 401


def test_ac_10_wrong_token_is_rejected(anonymous: TestClient) -> None:
    assert anonymous.get("/health", headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_ac_10_non_loopback_caller_is_forbidden(settings: Settings, db: Database) -> None:
    remote = TestClient(create_app(settings, db), client=("10.0.0.5", 50000))
    resp = remote.get("/health", headers={"Authorization": "Bearer test-launch-token"})
    assert resp.status_code == 403


def test_shipped_app_has_no_web_surface(client: TestClient) -> None:
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404


def test_desktop_profile_ignores_environment(monkeypatch, tmp_path) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("AIOS_ENV", "dev")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    desktop = load(Profile.DESKTOP)
    assert desktop.profile is Profile.DESKTOP
    assert desktop.public_paths == frozenset()
    assert desktop.db_key is None  # key only from the keystore


def test_dev_profile_opens_health_and_docs_without_token() -> None:
    dev = TestClient(create_app(load(Profile.DEV)), client=("127.0.0.1", 50000))
    assert dev.get("/docs").status_code == 200
    assert dev.get("/other").status_code == 401  # everything else still needs the token
