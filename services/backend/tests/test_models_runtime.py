"""Models additions: downloads from the mirror, catalogue check, engine, benchmark, model detail."""

import threading
import time
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from tests.conftest import LAUNCH_TOKEN, LOOPBACK
from tests.test_models import CONTENT, gguf, tiny_entry  # noqa: F401  (fixture)

from aios_backend.apps.models import catalogue
from aios_backend.apps.models.engine import BenchmarkRun, EngineState, Fallback
from aios_backend.config import Settings
from aios_backend.main import create_app
from db.session import Database

CHUNK = 128


class FakeMirror:
    """Serves CONTENT in small chunks. ``gate`` (when set) holds each chunk until released;
    with ``hold_after`` only the chunks from that index on."""

    def __init__(self, content: bytes = CONTENT) -> None:
        self.content = content
        self.gate: threading.Event | None = None
        self.hold_after: int | None = None
        self.offsets: list[int] = []
        self.version = "2026-12-01"
        self.down = False

    def fetch(self, entry_id: str, url: str, offset: int) -> Iterator[bytes]:
        if self.down:
            raise ConnectionError("mirror down")
        self.offsets.append(offset)
        for i, start in enumerate(range(offset, len(self.content), CHUNK)):
            if self.gate is not None and (self.hold_after is None or i >= self.hold_after):
                self.gate.wait(5)
            yield self.content[start : start + CHUNK]

    def catalogue_version(self) -> str:
        if self.down:
            raise ConnectionError("mirror down")
        return self.version


class FakeEngine:
    def __init__(self) -> None:
        self.current = EngineState(state="not_started", build="vulkan", loaded_model_id=None)
        self.started: list[tuple[str, bool]] = []

    def state(self) -> EngineState:
        return self.current

    def start(self, model_id: str, model_path: str, cpu_only: bool) -> EngineState:
        self.started.append((model_id, cpu_only))
        build = "cpu" if cpu_only else "vulkan"
        self.current = EngineState(state="ready", build=build, loaded_model_id=model_id)
        return self.current

    def benchmark(self, model_id: str, model_path: str, cpu_only: bool) -> BenchmarkRun:
        return BenchmarkRun(tokens_per_second=36.456, time_to_first_token_ms=410, build="vulkan")

    def acknowledge_fallback(self) -> None:
        if self.current.fallback:
            fb = self.current.fallback
            self.current = EngineState(
                state=self.current.state,
                build=self.current.build,
                loaded_model_id=self.current.loaded_model_id,
                fallback=Fallback(fb.occurred_at, fb.from_build, fb.to_build, True),
            )


@pytest.fixture
def mirror() -> FakeMirror:
    return FakeMirror()


@pytest.fixture
def engine() -> FakeEngine:
    return FakeEngine()


@pytest.fixture
def runtime(
    settings: Settings, db: Database, mirror: FakeMirror, engine: FakeEngine
) -> Iterator[TestClient]:
    headers = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}
    app = create_app(settings, db, local_engine=engine, mirror=mirror)
    with TestClient(app, client=LOOPBACK, headers=headers) as c:
        yield c


def wait_received(client: TestClient, entry_id: str, at_least: int) -> dict:
    deadline = time.monotonic() + 5
    while True:
        state = client.get(f"/models/downloads/{entry_id}").json()
        if state.get("received_bytes", 0) >= at_least:
            return state
        assert time.monotonic() < deadline, state
        time.sleep(0.01)


def pause_midway(client: TestClient, mirror: FakeMirror, entry_id: str) -> dict:
    """Start a download, let two chunks arrive, pause it, and return the paused state."""
    mirror.gate, mirror.hold_after = threading.Event(), 2
    client.post("/models/downloads", json={"entry_id": entry_id})
    wait_received(client, entry_id, 2 * CHUNK)
    pausing = threading.Thread(target=lambda: client.post(f"/models/downloads/{entry_id}/pause"))
    pausing.start()
    time.sleep(0.05)
    mirror.gate.set()  # the worker sees the pause at the next chunk
    pausing.join(5)
    mirror.gate = None
    return wait_for(client, entry_id, "paused")


def wait_for(client: TestClient, entry_id: str, status: str) -> dict:
    deadline = time.monotonic() + 5
    while True:
        state = client.get(f"/models/downloads/{entry_id}").json()
        if state.get("status") == status:
            return state
        assert time.monotonic() < deadline, state
        time.sleep(0.01)


# ------------------------------------------------------------------ downloads
def test_downloads_need_the_mirror(client: TestClient, tiny_entry: catalogue.Entry) -> None:  # noqa: F811
    resp = client.post("/models/downloads", json={"entry_id": tiny_entry.id})
    assert resp.status_code == 503 and resp.json() == {"error": "mirror_unavailable"}
    old = client.post(f"/models/download/{tiny_entry.id}")
    assert old.status_code == 503 and old.json() == {"error": "mirror_unavailable"}
    assert client.post("/models/downloads", json={"entry_id": "nope"}).json() == {
        "error": "catalogue_entry_not_found"
    }


def test_download_installs_a_verified_model(
    runtime: TestClient,
    tiny_entry: catalogue.Entry,  # noqa: F811
    settings: Settings,
) -> None:
    started = runtime.post("/models/downloads", json={"entry_id": tiny_entry.id})
    assert started.status_code == 202, started.text
    assert started.json()["total_bytes"] == len(CONTENT)

    done = wait_for(runtime, tiny_entry.id, "done")
    assert done["received_bytes"] == len(CONTENT) and done["error"] is None
    installed = runtime.get("/models").json()
    assert [(m["id"], m["source"]) for m in installed] == [(tiny_entry.id, "download")]
    assert (settings.models_dir / tiny_entry.file_name).read_bytes() == CONTENT
    assert not list(settings.models_dir.glob("*.download"))
    event = runtime.get("/evidence").json()[-1]
    assert event["event_type"] == "model_installed" and event["payload"]["source"] == "download"
    assert runtime.get("/models/downloads").json()[0]["status"] == "done"

    again = runtime.post("/models/downloads", json={"entry_id": tiny_entry.id})
    assert again.status_code == 409 and again.json() == {"error": "model_installed"}


def test_pause_and_resume_continue_where_it_stopped(
    runtime: TestClient,
    mirror: FakeMirror,
    tiny_entry: catalogue.Entry,  # noqa: F811
) -> None:
    paused = pause_midway(runtime, mirror, tiny_entry.id)
    assert 2 * CHUNK <= paused["received_bytes"] < len(CONTENT)
    again = runtime.post("/models/downloads", json={"entry_id": tiny_entry.id})
    assert again.status_code == 409 and again.json() == {"error": "download_exists"}

    resumed = runtime.post(f"/models/downloads/{tiny_entry.id}/resume")
    assert resumed.status_code == 200
    wait_for(runtime, tiny_entry.id, "done")
    assert mirror.offsets[-1] == paused["received_bytes"]  # HTTP range from the part's size


def test_cancel_deletes_the_partial_file(
    runtime: TestClient,
    mirror: FakeMirror,
    tiny_entry: catalogue.Entry,  # noqa: F811
    settings: Settings,
) -> None:
    mirror.gate = threading.Event()
    runtime.post("/models/downloads", json={"entry_id": tiny_entry.id})
    wait_for(runtime, tiny_entry.id, "downloading")
    canceller = threading.Thread(
        target=lambda: runtime.delete(f"/models/downloads/{tiny_entry.id}")
    )
    canceller.start()
    time.sleep(0.05)
    mirror.gate.set()
    canceller.join(5)
    assert runtime.get("/models/downloads").json() == []
    assert not list(settings.models_dir.glob("*.download"))
    assert runtime.get("/models").json() == []
    missing = runtime.post(f"/models/downloads/{tiny_entry.id}/pause")
    assert missing.status_code == 404 and missing.json() == {"error": "download_not_found"}


def test_a_wrong_file_fails_and_can_be_retried(
    runtime: TestClient,
    mirror: FakeMirror,
    tiny_entry: catalogue.Entry,  # noqa: F811
) -> None:
    mirror.content = b"X" * len(CONTENT)  # right size, wrong bytes
    runtime.post("/models/downloads", json={"entry_id": tiny_entry.id})
    failed = wait_for(runtime, tiny_entry.id, "failed")
    assert failed["error"] == "digest_mismatch"
    assert runtime.get("/models").json() == []

    mirror.content = CONTENT
    runtime.post(f"/models/downloads/{tiny_entry.id}/resume")
    wait_for(runtime, tiny_entry.id, "done")


def test_an_unreachable_mirror_fails_the_download(
    runtime: TestClient,
    mirror: FakeMirror,
    tiny_entry: catalogue.Entry,  # noqa: F811
) -> None:
    mirror.down = True
    runtime.post("/models/downloads", json={"entry_id": tiny_entry.id})
    assert wait_for(runtime, tiny_entry.id, "failed")["error"] == "mirror_unreachable"


# ------------------------------------------------------------------ catalogue check
def test_catalogue_check(runtime: TestClient, client: TestClient, mirror: FakeMirror) -> None:
    assert client.post("/models/catalogue/check").json() == {"error": "mirror_unavailable"}

    out = runtime.post("/models/catalogue/check").json()
    assert out["version"] == "2026-12-01" and out["changed"] is True
    settings = runtime.get("/settings").json()
    assert settings["catalogue_version"] == "2026-12-01"
    assert settings["last_catalogue_check"] is not None
    assert runtime.post("/models/catalogue/check").json()["changed"] is False

    mirror.down = True
    assert runtime.post("/models/catalogue/check").json() == {"error": "catalogue_unreachable"}
    runtime.patch("/settings", json={"catalogue_check": False})
    off = runtime.post("/models/catalogue/check")
    assert off.status_code == 409 and off.json() == {"error": "catalogue_check_off"}


# ------------------------------------------------------------------ engine and benchmark
def test_engine_and_benchmark_need_the_engine(
    client: TestClient,
    tmp_path: Path,
    tiny_entry: catalogue.Entry,  # noqa: F811
) -> None:
    assert client.post("/engine/start").json() == {"error": "no_model"}
    assert client.post("/system/benchmark").json() == {"error": "no_model"}
    client.post("/models/import", json={"path": str(gguf(tmp_path))})
    resp = client.post("/system/benchmark")
    assert resp.status_code == 503 and resp.json() == {"error": "engine_unavailable"}
    assert client.post("/engine/start").json() == {"error": "engine_unavailable"}
    assert client.post("/engine/fallback/acknowledge").status_code == 204


def test_engine_start_status_and_safe_mode(
    runtime: TestClient,
    engine: FakeEngine,
    tmp_path: Path,
    tiny_entry: catalogue.Entry,  # noqa: F811
) -> None:
    runtime.post("/models/import", json={"path": str(gguf(tmp_path))})
    assert runtime.get("/engine/status").json()["state"] == "not_started"

    status = runtime.post("/engine/start", json={}).json()
    assert status["state"] == "ready" and status["build"] == "vulkan"
    assert status["loaded_model_id"] == tiny_entry.id

    runtime.patch("/settings", json={"safe_mode_cpu": True})
    assert runtime.post("/engine/start", json={"model_id": tiny_entry.id}).json()["build"] == "cpu"
    assert engine.started[-1] == (tiny_entry.id, True)
    missing = runtime.post("/engine/start", json={"model_id": "nope"})
    assert missing.status_code == 404 and missing.json() == {"error": "model_not_found"}


def test_benchmark_is_stored_and_shown_with_the_hardware(
    runtime: TestClient,
    tmp_path: Path,
    tiny_entry: catalogue.Entry,  # noqa: F811
) -> None:
    assert runtime.get("/system/hardware").json()["benchmark"] is None
    runtime.post("/models/import", json={"path": str(gguf(tmp_path))})
    run = runtime.post("/system/benchmark").json()
    assert run["model_id"] == tiny_entry.id and run["engine"] == "vulkan"
    assert run["tokens_per_second"] == 36.46 and run["time_to_first_token_ms"] == 410
    assert runtime.get("/system/hardware").json()["benchmark"] == run


def test_fallback_notice_is_reported_and_acknowledged(
    runtime: TestClient,
    engine: FakeEngine,
    tmp_path: Path,
    tiny_entry: catalogue.Entry,  # noqa: F811
) -> None:
    runtime.post("/models/import", json={"path": str(gguf(tmp_path))})
    at = datetime(2026, 11, 6, 9, 30, tzinfo=UTC)
    engine.current = EngineState(
        "ready", "cpu", tiny_entry.id, Fallback(at, "vulkan", "cpu", False)
    )
    fallback = runtime.get("/engine/status").json()["fallback"]
    assert fallback["from_build"] == "vulkan" and fallback["acknowledged"] is False
    assert runtime.post("/engine/fallback/acknowledge").status_code == 204
    assert runtime.get("/engine/status").json()["fallback"]["acknowledged"] is True


# ------------------------------------------------------------------ one model
def test_model_detail_has_the_verification_checks(
    client: TestClient,
    tmp_path: Path,
    tiny_entry: catalogue.Entry,  # noqa: F811
) -> None:
    client.post("/models/import", json={"path": str(gguf(tmp_path))})
    detail = client.get(f"/models/{tiny_entry.id}").json()
    assert detail["id"] == tiny_entry.id
    assert detail["checks"]["digest_matches"] is True
    assert detail["checks"]["provenance_complete"] is True
    assert client.get("/models/nope").json() == {"error": "model_not_found"}
    # Fixed paths still win over the model id.
    assert "entries" in client.get("/models/catalogue").json()
    assert client.get("/models/downloads").json() == []
