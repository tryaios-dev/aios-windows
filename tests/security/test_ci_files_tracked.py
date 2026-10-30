"""Every file that CI, the release job or a pnpm script runs must be committed.

A too-broad .gitignore line (`release/`) once hid tools/release/ from git, so CI failed on
scripts that only existed on a developer's machine. This test catches that locally.
"""

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]

# Repo-relative paths to files that get executed or read: scripts, specs, configs.
PATH = re.compile(
    r"(?<![\w./-])((?:tools|build|services|packages|apps|contracts)/[\w./-]+\.(?:py|mjs|js|ps1|spec|json|yml))\b"
)


def referenced_files() -> set[str]:
    sources = [*(ROOT / ".github" / "workflows").glob("*.yml")]
    text = "\n".join(p.read_text("utf-8") for p in sources)
    scripts = json.loads((ROOT / "package.json").read_text("utf-8"))["scripts"]
    text += "\n" + "\n".join(scripts.values())
    return {
        m.group(1)
        for m in PATH.finditer(text)
        if not m.group(1).startswith(("build/out/", "apps/desktop/release/"))
    }


def test_ci_and_script_files_are_committed() -> None:
    git = shutil.which("git")
    if git is None or not (ROOT / ".git").exists():
        pytest.skip("not a git checkout")
    cmd = [git, "ls-files"]
    result = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, check=True)  # noqa: S603
    tracked = set(result.stdout.splitlines())
    referenced = referenced_files()
    assert referenced, "found no file references; the pattern is probably broken"
    missing = sorted(f for f in referenced if f not in tracked)
    assert not missing, (
        f"referenced by CI or package.json but not committed (check .gitignore): {missing}"
    )
