"""Backend settings. Exactly ONE database: chats.db (the evidence database is never declared here).

Three profiles:

* ``desktop`` - the shipped backend.exe. Forced by ``__main__``; the environment cannot change
  it. Data in %LOCALAPPDATA%\\AIOS, DB key in Windows Credential Manager. Every request
  needs the launch token. No docs pages.
* ``dev``     - a developer machine (``aios-backend serve``). Database in
  ``services/backend/.dev/``, fixed dev key, fixed port, and ``/health`` and ``/docs`` open
  without a token so you can check the backend in a browser.
* ``test``    - pytest. Database in a temp folder, fixed test key.

The dev/test keys are not secrets: they only protect throw-away development data.
"""

import os
import tempfile
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

from aios_common import paths

PROFILE_ENV = "AIOS_ENV"
DEV_DIR = Path(__file__).resolve().parents[2] / ".dev"  # services/backend/.dev
DEV_DB_KEY = "de" * 32  # 256-bit hex; development data only
TEST_DB_KEY = "00" * 32


class Profile(StrEnum):
    DESKTOP = "desktop"
    DEV = "dev"
    TEST = "test"


@dataclass(frozen=True)
class Settings:
    profile: Profile
    chats_db: Path
    db_key: str | None  # None -> key from the OS keystore
    log_file: Path | None
    backups_dir: Path
    # Paths reachable without the token. Empty in the shipped app.
    public_paths: frozenset[str] = frozenset()
    docs_enabled: bool = False


def load(profile: Profile | str | None = None) -> Settings:
    """Settings for ``profile`` (default: $AIOS_ENV, else dev)."""
    chosen = Profile(profile or os.environ.get(PROFILE_ENV) or Profile.DEV)

    if chosen is Profile.DESKTOP:
        paths.ensure_dirs()
        return Settings(
            profile=chosen,
            chats_db=paths.chats_db(),
            db_key=None,
            log_file=paths.logs_dir() / "backend.log",
            backups_dir=paths.data_dir() / "backups",
        )

    if chosen is Profile.DEV:
        DEV_DIR.mkdir(parents=True, exist_ok=True)
        return Settings(
            profile=chosen,
            chats_db=DEV_DIR / "chats.db",
            db_key=DEV_DB_KEY,
            log_file=DEV_DIR / "backend.log",
            backups_dir=DEV_DIR / "backups",
            public_paths=frozenset({"/health", "/docs", "/openapi.json"}),
            docs_enabled=True,
        )

    tmp = Path(tempfile.gettempdir()) / "aios-test"
    tmp.mkdir(exist_ok=True)
    return Settings(
        profile=chosen,
        chats_db=tmp / "chats-test.db",
        db_key=TEST_DB_KEY,
        log_file=None,
        backups_dir=tmp / "backups",
    )
