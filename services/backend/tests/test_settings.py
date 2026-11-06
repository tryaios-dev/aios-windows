"""D-06: "Safe mode (CPU)" setting: saved in chats.db, applied at once and after a restart."""

import dataclasses
from pathlib import Path

from fastapi.testclient import TestClient
from tests.conftest import LAUNCH_TOKEN, LOOPBACK
from tests.test_engine_manager import FakeEngines, setup

from aios_backend.config import Settings
from aios_backend.main import create_app
from db.session import Database

HEADERS = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}


def test_safe_mode_is_off_by_default(client: TestClient) -> None:
    assert client.get("/settings/engine").json() == {"safe_mode": False}


def test_safe_mode_needs_the_launch_token(anonymous: TestClient) -> None:
    assert anonymous.get("/settings/engine").status_code == 401
    assert anonymous.put("/settings/engine", json={"safe_mode": True}).status_code == 401


def test_bad_bodies_are_rejected(client: TestClient) -> None:
    for body in ({}, {"safe_mode": "yes"}, {"safe_mode": True, "other": 1}):
        assert client.put("/settings/engine", json=body).status_code == 422


def test_d06_safe_mode_applies_at_once(client: TestClient) -> None:
    resp = client.put("/settings/engine", json={"safe_mode": True})
    assert resp.status_code == 200 and resp.json() == {"safe_mode": True}
    assert client.get("/settings/engine").json() == {"safe_mode": True}
    assert client.app.state.engine.safe_mode  # type: ignore[attr-defined]


def test_d06_safe_mode_persists_and_the_gpu_build_never_starts_after_a_restart(
    settings: Settings, db: Database, tmp_path: Path
) -> None:
    with TestClient(create_app(settings, db), client=LOOPBACK, headers=HEADERS) as c:
        c.put("/settings/engine", json={"safe_mode": True})

    # Restart, on a machine with a GPU and the GPU build installed.
    fakes = FakeEngines(gpus=["Vulkan0"])
    manager, components = setup(tmp_path / "restart", fakes, vulkan=True)
    app = create_app(dataclasses.replace(settings), db)
    app.state.engine = manager
    try:
        with TestClient(app, client=LOOPBACK, headers=HEADERS) as c:
            assert c.get("/settings/engine").json() == {"safe_mode": True}
            engine = c.portal.call(manager.ensure)
            assert engine.build == "cpu" and components.engine_build == "cpu"
    finally:
        fakes.cleanup()
    assert fakes.started == ["cpu"]
    assert fakes.probes == 0  # the Vulkan binary was not even run to look for a GPU
