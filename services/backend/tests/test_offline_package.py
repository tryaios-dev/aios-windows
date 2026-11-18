"""K-05 / I-04 / N-02: the offline package. A folder with Setup.exe and a ``models`` folder: the
installer copies the model files into ``<models folder>/offline`` (build/installer/installer.nsh),
and the app installs them with the same size, digest and review checks as any import (MVP 10.1).
A file that fails the checks is deleted; nothing unverified is kept."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from tests.test_models import CONTENT, tiny_entry  # noqa: F401  (fixture)

from aios_backend.apps.models import catalogue
from aios_backend.config import Settings


def stage(settings: Settings, content: bytes = CONTENT, name: str = "tiny-test.gguf") -> Path:
    """What the installer leaves: the file from the package, in the staging folder."""
    folder = settings.models_dir / "offline"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    path.write_bytes(content)
    return path


def test_k05_no_package_lists_nothing(client: TestClient) -> None:
    assert client.get("/models/offline-package").json() == []


def test_k05_the_model_from_the_package_is_checked_and_installed(
    client: TestClient,
    settings: Settings,
    tiny_entry: catalogue.Entry,  # noqa: F811
) -> None:
    staged = stage(settings)
    assert client.get("/models/offline-package").json() == [
        {"file_name": "tiny-test.gguf", "size_bytes": len(CONTENT), "entry_id": tiny_entry.id}
    ]
    resp = client.post("/models/offline-package/install", json={"file_name": "tiny-test.gguf"})
    assert resp.status_code == 201, resp.text
    model = resp.json()
    assert model["id"] == tiny_entry.id and model["source"] == "offline"
    assert Path(model["file_path"]) == settings.models_dir / tiny_entry.file_name
    assert Path(model["file_path"]).read_bytes() == CONTENT
    assert not staged.exists()  # moved, not copied a second time
    assert client.get("/models/offline-package").json() == []
    events = [e for e in client.get("/evidence").json() if e["event_type"] == "model_installed"]
    assert events[-1]["payload"]["source"] == "offline"


def test_k05_a_damaged_file_in_the_package_is_refused_and_removed(
    client: TestClient,
    settings: Settings,
    tiny_entry: catalogue.Entry,  # noqa: F811
) -> None:
    staged = stage(settings, content=b"GGUF" + b"\x01" * (len(CONTENT) - 4))  # same size
    resp = client.post("/models/offline-package/install", json={"file_name": staged.name})
    assert (resp.status_code, resp.json()) == (422, {"error": "digest_mismatch"})
    assert not staged.exists()  # an unverified file is never kept
    assert client.get("/models").json() == []


@pytest.mark.parametrize("name", ["../tiny-test.gguf", "sub/tiny-test.gguf", "notes.txt", ""])
def test_k05_only_a_file_name_in_the_package_folder(
    client: TestClient, settings: Settings, name: str
) -> None:
    stage(settings)
    resp = client.post("/models/offline-package/install", json={"file_name": name})
    assert resp.status_code in (400, 422) and resp.json()["error"] in {
        "invalid_path",
        "invalid_request",
    }


def test_k05_a_missing_package_file_is_404(client: TestClient) -> None:
    resp = client.post("/models/offline-package/install", json={"file_name": "gone.gguf"})
    assert (resp.status_code, resp.json()) == (404, {"error": "package_file_not_found"})
