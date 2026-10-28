import os
from pathlib import Path


def data_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / ".local" / "share")
    return Path(base) / "AIOS"


def chats_db() -> Path:
    return data_dir() / "data" / "chats.db"


def recovery_pkg() -> Path:
    return data_dir() / "data" / "recovery.pkg"


def models_dir() -> Path:
    return data_dir() / "models"


def logs_dir() -> Path:
    return data_dir() / "logs"


def ensure_dirs() -> None:
    """Create the per-user data folders on first start (10.1 installed layout)."""
    for d in (data_dir() / "data", models_dir(), logs_dir(), data_dir() / "backups"):
        d.mkdir(parents=True, exist_ok=True)
