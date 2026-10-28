"""Weekly full security suite (MVP 13.2). Starts with a repository secret scan; token, loopback,
CSP and log-content checks against the packaged app are added from week 4."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SKIP = {"node_modules", ".venv", "venv", ".git", "dist", "out", ".dev"}
MARKERS = ("BEGIN PRIVATE KEY", "BEGIN RSA PRIVATE KEY", "BEGIN OPENSSH PRIVATE KEY")


def test_no_private_keys_committed() -> None:
    hits = []
    for p in ROOT.rglob("*"):
        if p.is_file() and not any(part in SKIP for part in p.relative_to(ROOT).parts):
            try:
                text = p.read_text("utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            if any(m in text for m in MARKERS) and p.name != Path(__file__).name:
                hits.append(str(p.relative_to(ROOT)))
    assert not hits, hits
