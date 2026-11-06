"""AIOS folders on this machine (10.1 installed layout). The base folder comes from the platform."""

from pathlib import Path

from aios_common import platforms


def data_dir() -> Path:
    return platforms.current().data_dir()


def chats_db() -> Path:
    return data_dir() / "data" / "chats.db"


def recovery_pkg() -> Path:
    return data_dir() / "data" / "recovery.pkg"


def models_dir() -> Path:
    return data_dir() / "models"


def logs_dir() -> Path:
    return data_dir() / "logs"


def ensure_dirs() -> None:
    """Create the per-user data folders on first start."""
    for d in (data_dir() / "data", models_dir(), logs_dir(), data_dir() / "backups"):
        d.mkdir(parents=True, exist_ok=True)
