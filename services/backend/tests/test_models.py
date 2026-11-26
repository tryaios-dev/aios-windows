"""Models app: catalogue, offline import with size and digest checks, delete, hardware."""

import dataclasses
import hashlib
import re
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from tests.conftest import LAUNCH_TOKEN, LOOPBACK

from aios_backend.apps.models import catalogue, hardware
from aios_backend.apps.models import service as models_service
from aios_backend.config import Settings
from aios_backend.main import create_app
from aios_common.platforms import Hardware
from db.session import Database

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


# ------------------------------------------------------------------ issue 11: a model is chosen
def test_the_first_ai_model_installed_is_the_one_chat_uses(
    client: TestClient, tmp_path: Path, tiny_entry: catalogue.Entry
) -> None:
    assert client.get("/settings").json()["default_model_id"] is None
    client.post("/models/import", json={"path": str(gguf(tmp_path))})
    assert client.get("/settings").json()["default_model_id"] == tiny_entry.id
    # Chosen by the person: installing never changes it.
    client.patch("/settings", json={"default_model_id": SMALL})
    client.delete(f"/models/{tiny_entry.id}")
    client.post("/models/import", json={"path": str(gguf(tmp_path))})
    assert client.get("/settings").json()["default_model_id"] == SMALL


def _restart(settings: Settings, db: Database) -> TestClient:
    headers = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}
    return TestClient(create_app(settings, db), client=LOOPBACK, headers=headers)


def test_opening_aios_with_one_model_and_none_chosen_chooses_it(
    client: TestClient,
    settings: Settings,
    db: Database,
    tmp_path: Path,
    tiny_entry: catalogue.Entry,
) -> None:
    """Installations from before the fix: the model is installed, nothing is chosen."""
    client.post("/models/import", json={"path": str(gguf(tmp_path))})
    client.patch("/settings", json={"default_model_id": None})
    with _restart(settings, db) as again:
        assert again.get("/settings").json()["default_model_id"] == tiny_entry.id
    with _restart(settings, db) as later:  # and it stays chosen
        assert later.get("/settings").json()["default_model_id"] == tiny_entry.id


def test_with_two_models_and_none_chosen_aios_does_not_guess(
    client: TestClient,
    settings: Settings,
    db: Database,
    tmp_path: Path,
    tiny_entry: catalogue.Entry,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client.post("/models/import", json={"path": str(gguf(tmp_path))})
    other_content = b"GGUF" + b"\x01" * 60
    other = dataclasses.replace(
        tiny_entry,
        id="tiny-two-q4km",
        file_name="tiny-two.gguf",
        size_bytes=len(other_content),
        artifact_digest=hashlib.sha256(other_content).hexdigest(),
    )
    real = catalogue.entries()
    monkeypatch.setattr(catalogue, "entries", lambda: (*real, other))
    path = gguf(tmp_path, other_content, name="two.gguf")
    assert client.post("/models/import", json={"path": str(path)}).status_code in (200, 201)
    client.patch("/settings", json={"default_model_id": None})
    with _restart(settings, db) as again:
        assert again.get("/settings").json()["default_model_id"] is None


def test_aios_still_opens_when_the_model_choice_cannot_be_read(
    client: TestClient,
    settings: Settings,
    db: Database,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """chats.db locked or unreadable at start-up: the choice is skipped, AIOS still opens."""

    def unreadable(session: object) -> None:
        raise RuntimeError("chats.db unreadable")

    monkeypatch.setattr(models_service, "choose_only_model", unreadable)
    with _restart(settings, db) as again:
        assert again.get("/settings").status_code == 200


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
# The rules themselves are tested in test_model_fit.py; these check the profiles catalogue v3
# was written for still get its pick.
def _suggest(
    ram: int, card_gb: float = 0, disk: int = 500, card_gbs: float | None = None
) -> str | None:
    from aios_backend.apps.models import fit

    gib = 1024**3
    machine = fit.Machine(ram, int((ram - 0.5) * gib), disk, 8, None, int(card_gb * gib), card_gbs)
    found = fit.pick(machine, fit.estimate(machine, catalogue.entries()), lambda e: True)
    return found.entry.id if found else None


@pytest.mark.parametrize(
    ("ram", "card_gb", "expected"),
    [
        (8, 0, SMALL),  # 8 GB, no graphics card
        (16, 0, SMALL),  # 16 GB, no card: Standard writes too slowly on the processor
        (16, 7.5, MEDIUM),  # an 8 GB card (7.5 GB free)
        (32, 7.5, SAGE),  # an 8 GB card and 32 GB: experts in system memory
        (16, 23, QWEN27),  # a 24 GB card: Qwen 27B no longer needs 64 GB of memory
        (64, 31, QWEN27),
        (16, 3.6, SMALL),  # a 4 GB card: Standard would be split and slow
    ],
)
def test_ac_02_one_model_is_suggested_per_computer(ram: int, card_gb: float, expected: str) -> None:
    assert _suggest(ram, card_gb) == expected


def test_ac_02_nothing_is_suggested_below_the_minimum() -> None:
    assert _suggest(4) is None
    assert _suggest(16, disk=9) is None


def test_ac_02_the_next_model_is_suggested_when_the_drive_is_too_small() -> None:
    # A 24 GB card but only 12 GB free: Qwen (16.6 GB) does not fit, Ornith (5.8 GB + 2 GB) does
    assert _suggest(64, 23, disk=12) == MEDIUM


def test_ac_02_only_reviewed_models_are_suggested(client: TestClient) -> None:
    """MVP 9.6: a third-party file needs a passed review; the large entries have none yet."""
    from aios_backend.apps.models import fit

    gib = 1024**3
    machine = fit.Machine(64, 63 * gib, 500, 8, None, 23 * gib, None)
    found = fit.pick(machine, fit.estimate(machine, catalogue.entries()), catalogue.installable)
    assert found is not None and found.entry.id == MEDIUM


def test_hardware_lists_every_model_with_its_fit(client: TestClient) -> None:
    hw = client.get("/system/hardware").json()
    assert [m["entry_id"] for m in hw["models"]] == [e.id for e in catalogue.entries()]
    for m in hw["models"]:
        assert m["fit"] in ("well", "slowly", "no")
        assert (m["runs_on"] is None) == (m["fit"] == "no")


# ------------------------------------------------------------------ hardware read at start-up
def _computer(ram_gb: int) -> Hardware:
    return Hardware(
        cpu="Test CPU", cores=8, ram_gb=ram_gb, gpu_name=None, vram_gb=None,
        gpu_driver_ok=False, free_disk_gb=200, os="Windows 11",
        usable_ram_bytes=(ram_gb - 1) * 1024**3, physical_cores=4,
    )  # fmt: skip


def _ram_gb_soon(c: TestClient, expected: int) -> int:
    """The start-up reading runs in the background: wait for it briefly."""
    for _ in range(100):
        ram = c.get("/system/hardware").json()["ram_gb"]
        if ram == expected:
            break
        time.sleep(0.05)
    return int(ram)


def test_hardware_is_read_again_each_time_aios_starts(
    client: TestClient, settings: Settings, db: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Settings says AIOS reads the hardware when it starts: memory added later counts."""
    monkeypatch.setattr(hardware, "detect", lambda disk: _computer(16))
    assert client.get("/system/hardware").json()["ram_gb"] == 16  # setup's reading
    monkeypatch.setattr(hardware, "detect", lambda disk: _computer(32))
    with _restart(settings, db) as again:
        assert _ram_gb_soon(again, 32) == 32


def test_a_failed_reading_at_start_up_keeps_the_last_one(
    client: TestClient, settings: Settings, db: Database, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(hardware, "detect", lambda disk: _computer(16))
    client.get("/system/hardware")

    def unreadable(disk: object) -> Hardware:
        raise OSError("firmware table unreadable")

    monkeypatch.setattr(hardware, "detect", unreadable)
    with _restart(settings, db) as again:
        time.sleep(0.3)
        assert again.get("/system/hardware").json()["ram_gb"] == 16
