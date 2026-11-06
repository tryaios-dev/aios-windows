"""D-06: "Safe mode (CPU)" (settings ``safe_mode_cpu``) reaches the engine's process manager:
at once when changed, and after a restart before any engine can start."""

import dataclasses
from pathlib import Path

from fastapi.testclient import TestClient
from tests.conftest import LAUNCH_TOKEN, LOOPBACK
from tests.test_engine_manager import FakeEngines, setup

from aios_backend.config import Settings
from aios_backend.main import create_app
from db.session import Database

HEADERS = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}


def test_d06_safe_mode_is_off_by_default(client: TestClient) -> None:
    assert client.get("/settings").json()["safe_mode_cpu"] is False
    assert not client.app.state.engine.safe_mode  # type: ignore[attr-defined]


def test_d06_safe_mode_applies_at_once_in_both_directions(client: TestClient) -> None:
    manager = client.app.state.engine  # type: ignore[attr-defined]
    resp = client.patch("/settings", json={"safe_mode_cpu": True})
    assert resp.status_code == 200 and resp.json()["safe_mode_cpu"] is True
    assert manager.safe_mode
    client.patch("/settings", json={"safe_mode_cpu": False})
    assert not manager.safe_mode


def test_d06_other_settings_leave_safe_mode_alone(client: TestClient) -> None:
    client.patch("/settings", json={"safe_mode_cpu": True})
    client.patch("/settings", json={"update_check": False})
    assert client.app.state.engine.safe_mode  # type: ignore[attr-defined]


def test_d06_safe_mode_persists_and_the_gpu_build_never_starts_after_a_restart(
    settings: Settings, db: Database, tmp_path: Path
) -> None:
    with TestClient(create_app(settings, db), client=LOOPBACK, headers=HEADERS) as c:
        c.patch("/settings", json={"safe_mode_cpu": True})

    # Restart, on a machine with a GPU and the GPU build installed.
    fakes = FakeEngines(gpus=["Vulkan0"])
    manager, components = setup(tmp_path / "restart", fakes, vulkan=True)
    app = create_app(dataclasses.replace(settings), db)
    app.state.engine = manager
    try:
        with TestClient(app, client=LOOPBACK, headers=HEADERS) as c:
            assert c.get("/settings").json()["safe_mode_cpu"] is True
            engine = c.portal.call(manager.ensure)
            assert engine.build == "cpu" and components.engine_build == "cpu"
    finally:
        fakes.cleanup()
    assert fakes.started == ["cpu"]
    assert fakes.probes == 0  # the Vulkan binary was not even run to look for a GPU
