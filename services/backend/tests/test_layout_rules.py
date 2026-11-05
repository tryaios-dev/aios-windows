"""Source-level rules from the Process and IPC Contract v1 that settings alone cannot prove."""

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
BACKEND_SOURCES = [
    ROOT / "services/backend/aios_backend",
    ROOT / "services/backend/db",
    ROOT / "packages/py/aios-common/src/aios_common",
]


def _string_literals_outside_docstrings(path: Path) -> list[str]:
    tree = ast.parse(path.read_text("utf-8"))
    docstrings = {
        id(node.body[0].value)
        for node in ast.walk(tree)
        if isinstance(node, ast.Module | ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef)
        and node.body
        and isinstance(node.body[0], ast.Expr)
        and isinstance(node.body[0].value, ast.Constant)
    }
    return [
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and id(node) not in docstrings
    ]


def test_ac_14_no_backend_code_names_evidence_db() -> None:
    # Only the evidence writer opens evidence.db; the backend reads evidence through the
    # writer's API (question 8). A path built in code is the first step to opening it.
    for folder in BACKEND_SOURCES:
        for path in folder.rglob("*.py"):
            for literal in _string_literals_outside_docstrings(path):
                assert "evidence.db" not in literal.lower(), (
                    f"{path.relative_to(ROOT)}: {literal!r}"
                )
