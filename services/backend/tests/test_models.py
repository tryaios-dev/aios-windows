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
    assert {e["entry_id"] for e in out["entries"]} == {SMALL, MEDIUM, SAGE, QWEN27}


REPO = Path(__file__).resolve().parents[3]
SMALL = "minicpm5-2b-q4_k_m-openbmb-gguf"
MEDIUM = "ornith-1.5-9b-q4_k_m-ornith-gguf"
SAGE = "sage-a1.5-q4_k_m-mradermacher-gguf"
QWEN27 = "qwen3.8-27b-ud-q4_k_m-unsloth-gguf"


def test_catalogue_lists_only_real_published_files() -> None:
    """Bug 2: no placeholder sizes or hashes. Every entry is a real published file on Hugging
    Face at a pinned revision, with its licence text in the repository. Only reviewed entries can
    be installed (MVP 9.6); the two large ones wait for their review."""
    entries = catalogue.entries()
    assert {e.tier for e in entries} == {"small", "medium", "large"}
    for e in entries:
        assert re.fullmatch(r"[0-9a-f]{64}", e.artifact_digest), e.id
        assert len(set(e.artifact_digest)) > 4, e.id  # not a made-up repeating pattern
        assert re.fullmatch(r"[0-9a-f]{40}", e.upstream_revision), e.id
        assert (REPO / e.licence_reference).is_file(), e.licence_reference
        assert e.mirror_url == (
            f"https://huggingface.co/{e.upstream_model}/resolve/{e.upstream_revision}/{e.file_name}"
        )
    assert {e.id for e in entries if catalogue.installable(e)} == {SMALL, MEDIUM}
    small = catalogue.find(SMALL)
    assert small is not None and small.size_bytes == 1561318368
    assert small.artifact_digest.startswith("ec2d5801")


@pytest.mark.parametrize(
    "review",
    [
        None,
        {"reviewer": "", "date": "2026-11-06", "quality_threshold_result": "pass"},
        {"reviewer": "Reviewer", "date": "", "quality_threshold_result": "pass"},
        {"reviewer": "Reviewer", "date": "2026-11-06", "quality_threshold_result": "pending"},
        {"reviewer": "Reviewer", "date": "2026-11-06", "quality_threshold_result": "fail"},
    ],
)
def test_ac_02_a_third_party_file_without_a_passed_review_is_refused(
    client: TestClient,
    settings: Settings,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    tiny_entry: catalogue.Entry,
    review: dict[str, str] | None,
) -> None:
    entry = dataclasses.replace(tiny_entry, pipeline="third-party", deviation_review=review)
    monkeypatch.setattr(catalogue, "entries", lambda: (entry,))
    r = client.post("/models/import", json={"path": str(gguf(tmp_path)), "entry_id": entry.id})
    assert (r.status_code, r.json()) == (422, {"error": "deviation_not_approved"})
    assert client.get("/models").json() == []
    assert not (settings.models_dir / entry.file_name).exists()


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
    [
        (b"GGUF" + b"\x01" * 1020, "digest_mismatch"),
        (CONTENT[:-1] + b"\x01", "digest_mismatch"),  # one byte changed
        (b"GGUF short", "size_mismatch"),
    ],
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
    r = client.post(f"/models/download/{SMALL}")
    assert (r.status_code, r.json()) == (503, {"error": "mirror_unavailable"})
    assert client.post("/models/download/nope").status_code == 404


def test_hardware_is_read_from_this_machine_and_kept(client: TestClient) -> None:
    hw = client.get("/system/hardware").json()
    assert hw["cores"] >= 1 and hw["ram_gb"] >= 0 and hw["cpu"]
    assert hw["recommended_tier"] in ("small", "medium", "large", None)
    assert hw["recommended_entry_id"] in (SMALL, MEDIUM, SAGE, QWEN27, None)
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
        "state": "not_started",
        "installed": 1,
        **no_engine,
    }


def test_ac_02_a_third_party_entry_without_a_passed_review_is_not_downloaded(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tiny_entry: catalogue.Entry
) -> None:
    entry = dataclasses.replace(tiny_entry, pipeline="third-party", deviation_review=None)
    monkeypatch.setattr(catalogue, "entries", lambda: (entry,))
    r = client.post(f"/models/download/{entry.id}")
    assert (r.status_code, r.json()) == (422, {"error": "deviation_not_approved"})


# ------------------------------------------------------------------ the one suggested model
def _suggest(ram: int, vram: int | None, disk: int = 500, driver_ok: bool = True) -> str | None:
    from aios_backend.apps.models import hardware

    entry = hardware.recommend(ram, disk, vram, driver_ok, catalogue.entries(), lambda e: True)
    return entry.id if entry else None


@pytest.mark.parametrize(
    ("ram", "vram", "expected"),
    [
        (8, None, SMALL),  # 8 GB RAM, no dedicated GPU
        (16, None, SMALL),  # 16 GB RAM, no dedicated GPU: still the CPU pick (catalogue v3)
        (16, 8, MEDIUM),  # 8 GB GPU, 16 GB RAM
        (32, 8, SAGE),  # 8 GB GPU, 32 GB RAM: experts in system memory
        (32, 16, SAGE),  # 16 GB GPU, 32 GB RAM
        (64, 24, QWEN27),  # 24 GB GPU, 64 GB RAM
        (64, 32, QWEN27),
        (16, 4, SMALL),  # a 4 GB GPU counts as no dedicated GPU
    ],
)
def test_ac_02_one_model_is_suggested_per_catalogue_v3_windows_profile(
    ram: int, vram: int | None, expected: str
) -> None:
    assert _suggest(ram, vram) == expected


def test_ac_02_nothing_is_suggested_below_the_minimum() -> None:
    assert _suggest(4, None) is None
    assert _suggest(16, None, disk=9) is None


def test_ac_02_a_gpu_without_a_driver_counts_as_no_gpu() -> None:
    assert _suggest(16, 8, driver_ok=False) == SMALL


def test_ac_02_the_next_model_is_suggested_when_the_drive_is_too_small() -> None:
    # 64 GB RAM and a 24 GB GPU, but only 12 GB free: Qwen (16.6 GB) and Ornith (5.8 GB + 2 GB
    # working space fits) -> Ornith
    assert _suggest(64, 24, disk=12) == MEDIUM


def test_ac_02_only_reviewed_models_are_suggested() -> None:
    """MVP 9.6: a third-party file needs a passed review; the large entries have none yet."""
    from aios_backend.apps.models import hardware

    entry = hardware.recommend(64, 500, 24, True, catalogue.entries(), catalogue.installable)
    assert entry is not None and entry.id == MEDIUM
