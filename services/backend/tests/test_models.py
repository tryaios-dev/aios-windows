"""Models app: catalogue, offline import with size and digest checks, delete, hardware."""

import dataclasses
import hashlib
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from aios_backend.apps.models import catalogue
from aios_backend.config import Settings

UI_CATALOGUE = Path(__file__).resolve().parents[3] / "apps/ui/src/bridge/sim/catalogue.ts"
CONTENT = b"GGUF" + b"\x00" * 1020  # a tiny stand-in for a model file


@pytest.fixture
def tiny_entry(monkeypatch: pytest.MonkeyPatch) -> catalogue.Entry:
    """Add a catalogue entry that matches CONTENT, so a real import can run in a test."""
    base = catalogue.entries()[0]
    entry = dataclasses.replace(
        base,
        id="tiny-test-q4km",
        name="Tiny test model",
        tier="small",
        file_name="tiny-test.gguf",
        size_bytes=len(CONTENT),
        artifact_digest=hashlib.sha256(CONTENT).hexdigest(),
        context_length=2048,
    )
    real = catalogue.entries()
    monkeypatch.setattr(catalogue, "entries", lambda: (*real, entry))
    return entry


def gguf(tmp_path: Path, content: bytes = CONTENT, name: str = "download.gguf") -> Path:
    path = tmp_path / "picked" / name
    path.parent.mkdir(exist_ok=True)
    path.write_bytes(content)
    return path


def test_backend_catalogue_equals_the_one_the_ui_shows() -> None:
    ui = UI_CATALOGUE.read_text("utf-8")
    ui_entries = {
        m.group(1): (int(m.group(3).replace("_", "")), m.group(2))
        for m in re.finditer(
            r'entry_id: "([^"]+)".*?artifact_digest: "([0-9a-f]{64})",\s+size_bytes: ([\d_]+)',
            ui,
            re.S,
        )
    }
    backend = {e.id: (e.size_bytes, e.artifact_digest) for e in catalogue.entries()}
    assert backend == ui_entries


def test_catalogue_endpoint(client: TestClient) -> None:
    out = client.get("/models/catalogue").json()
    assert out["signed"] is False
    assert {e["entry_id"] for e in out["entries"]} >= {"qwen3-4b-q4km", "qwen3-8b-q4km"}


def test_import_installs_a_matching_file_and_records_evidence(
    client: TestClient, settings: Settings, tmp_path: Path, tiny_entry: catalogue.Entry
) -> None:
    r = client.post("/models/import", json={"path": str(gguf(tmp_path)), "entry_id": tiny_entry.id})
    assert r.status_code == 201, r.text
    model = r.json()
    assert model["id"] == tiny_entry.id and model["source"] == "offline"
    assert Path(model["file_path"]).parent == settings.models_dir
    assert Path(model["file_path"]).read_bytes() == CONTENT
    assert [m["id"] for m in client.get("/models").json()] == [tiny_entry.id]
    events = [e["event_type"] for e in client.get("/evidence").json()]
    assert "model_installed" in events
    again = client.post("/models/import", json={"path": str(gguf(tmp_path))})
    assert (again.status_code, again.json()) == (409, {"error": "model_installed"})


def test_import_without_entry_finds_it_by_size_and_digest(
    client: TestClient, tmp_path: Path, tiny_entry: catalogue.Entry
) -> None:
    r = client.post("/models/import", json={"path": str(gguf(tmp_path))})
    assert r.status_code == 201 and r.json()["id"] == tiny_entry.id


@pytest.mark.parametrize(
    ("content", "error"),
    [(b"GGUF" + b"\x01" * 1020, "digest_mismatch"), (b"GGUF short", "size_mismatch")],
)
def test_a_file_that_is_not_byte_for_byte_the_entry_is_refused(
    client: TestClient,
    settings: Settings,
    tmp_path: Path,
    tiny_entry: catalogue.Entry,
    content: bytes,
    error: str,
) -> None:
    path = gguf(tmp_path, content)
    r = client.post("/models/import", json={"path": str(path), "entry_id": tiny_entry.id})
    assert (r.status_code, r.json()) == (422, {"error": error})
    assert client.get("/models").json() == []
    assert not (settings.models_dir / tiny_entry.file_name).exists()


def test_import_needs_an_absolute_gguf_path(client: TestClient, tmp_path: Path) -> None:
    assert client.post("/models/import", json={"path": "model.gguf"}).json() == {
        "error": "invalid_path"
    }
    other = gguf(tmp_path, name="notes.txt")
    assert client.post("/models/import", json={"path": str(other)}).json() == {"error": "not_gguf"}


def test_deleting_the_default_model_removes_the_file_and_clears_the_default(
    client: TestClient, tmp_path: Path, tiny_entry: catalogue.Entry
) -> None:
    model = client.post("/models/import", json={"path": str(gguf(tmp_path))}).json()
    client.patch("/settings", json={"default_model_id": tiny_entry.id})
    assert client.delete(f"/models/{tiny_entry.id}").status_code == 204
    assert not Path(model["file_path"]).exists()
    assert client.get("/settings").json()["default_model_id"] is None
    assert client.get("/models").json() == []
    assert "model_deleted" in [e["event_type"] for e in client.get("/evidence").json()]
    assert client.delete(f"/models/{tiny_entry.id}").json() == {"error": "model_not_found"}


def test_download_is_not_available_in_this_build(client: TestClient) -> None:
    r = client.post("/models/download/qwen3-4b-q4km")
    assert (r.status_code, r.json()) == (503, {"error": "mirror_unavailable"})
    assert client.post("/models/download/nope").status_code == 404


def test_hardware_is_read_from_this_machine_and_kept(client: TestClient) -> None:
    hw = client.get("/system/hardware").json()
    assert hw["cores"] >= 1 and hw["ram_gb"] >= 0 and hw["cpu"]
    assert hw["recommended_tier"] in ("small", "medium", None)
    assert client.get("/system/hardware").json()["checked_at"] == hw["checked_at"]
    assert client.get("/system/hardware?refresh=true").json()["checked_at"] >= hw["checked_at"]


def test_engine_status(client: TestClient, tmp_path: Path, tiny_entry: catalogue.Entry) -> None:
    no_engine = {"build": None, "loaded_model_id": None, "fallback": None}
    assert client.get("/engine/status").json() == {
        "state": "no_model",
        "installed": 0,
        **no_engine,
    }
    client.post("/models/import", json={"path": str(gguf(tmp_path))})
    assert client.get("/engine/status").json() == {
        "state": "not_built",
        "installed": 1,
        **no_engine,
    }
