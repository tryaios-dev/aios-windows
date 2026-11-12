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


# Modules allowed to use an HTTP client: the one door to the network (G-08) and the loopback
# clients for the evidence writer and the temporary D-04 spike. Anything that reaches the network
# must go through aios_backend.net, so the allowlist is checked on every request (M-22, AC-21).
HTTP_CLIENTS = {
    "aios_backend/net.py",
    "aios_backend/evidence/client.py",
    "aios_backend/apps/spike/service.py",  # loopback to the engine; removed by G-01
    "aios_backend/engine/launcher.py",  # loopback: polls the engine's /health (IPC-33)
}
NETWORK_MODULES = {"httpx", "requests", "urllib.request", "http.client", "aiohttp", "socket"}


def test_ac_21_only_the_network_door_imports_an_http_client() -> None:
    backend = ROOT / "services/backend"
    found = set()
    for path in (backend / "aios_backend").rglob("*.py"):
        tree = ast.parse(path.read_text("utf-8"))
        for node in ast.walk(tree):
            names = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                names = [node.module]
            if any(n in NETWORK_MODULES and n != "socket" for n in names):
                found.add(path.relative_to(backend).as_posix())
    assert found <= HTTP_CLIENTS, f"outbound HTTP outside aios_backend.net: {found - HTTP_CLIENTS}"
