"""Run each Python test suite in its own folder (own conftest). Extra args go to pytest."""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SUITES = [
    (ROOT, ["packages/py", "tests/security"]),
    (ROOT / "services" / "backend", []),
]

code = 0
for cwd, args in SUITES:
    code |= subprocess.call([sys.executable, "-m", "pytest", *args, *sys.argv[1:]], cwd=cwd)
sys.exit(code)
