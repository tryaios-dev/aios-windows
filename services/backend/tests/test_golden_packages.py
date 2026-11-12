"""AC-16: every golden Project Package v1 imports with its conversations, summaries and classes."""

import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

GOLDEN = (
    Path(__file__).resolve().parents[3] / "contracts" / "project-package" / "v1" / "golden-vectors"
)
EXPECTED = json.loads((GOLDEN / "expected.json").read_text())


@pytest.mark.parametrize("name", sorted(EXPECTED))
def test_ac_16_golden_package_imports(client: TestClient, tmp_path: Path, name: str) -> None:
    expected = EXPECTED[name]
    copy = tmp_path / name
    shutil.copy2(GOLDEN / name, copy)
    out = client.post("/projects/import", json={"path": str(copy)}).json()
    assert "error" not in out, out
    assert (out["conversations"], out["messages"], out["summaries"]) == (
        expected["conversations"],
        expected["messages"],
        expected["summaries"],
    )
    for text in expected["warnings_contain"]:
        assert any(text in w for w in out["warnings"]), out["warnings"]
    project = client.get(f"/projects/{out['project_id']}").json()
    assert project["classification"] == expected["classification"]
    assert project["classification_source"] == "import"
    for conv in client.get(f"/projects/{project['id']}/conversations").json():
        assert conv["classification_effective"] == expected["classification"]
        for message in client.get(f"/conversations/{conv['id']}/messages").json():
            assert message["classification_effective"] == expected["classification"]
