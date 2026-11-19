"""Backend settings. Exactly ONE database: chats.db (the evidence database is never declared here).

Three profiles:

* ``desktop`` - the shipped app (backend.exe on Windows). Forced by ``__main__``; the
  environment cannot change it. Starts only on an OS AIOS ships for (Windows); folders and the
  key store come from ``aios_common.platforms`` (Windows: the user's local app-data folder and
  Credential Manager). Every request needs the launch token. No docs pages.
* ``dev``     - a developer machine (``aios-backend serve``). Database in
  ``services/backend/.dev/``, fixed dev key, fixed port, and ``/health`` and ``/docs`` open
  without a token so you can check the backend in a browser.
* ``test``    - pytest. Database in a temp folder, fixed test key.

The Company AI server (G-06) is switched on by an operator file, ``operator.json`` (machine-wide
in the desktop profile, ``paths.operator_file()``; in ``.dev/`` in the dev profile), or else by
``company.json``, which ``aios-backend company set`` writes in the data folder (``.dev/`` in the
dev profile). Never in tests. See ``company_from_file``, ``with_company`` and
docs/operations/company-server.md.

The dev/test keys (database key and evidence signing seed) are not secrets: they only protect throw-away development data.
"""

import json
import os
import sys
import tempfile
from dataclasses import dataclass, replace
from enum import StrEnum
from pathlib import Path
from typing import Any

from aios_backend.company_config import (
    FILE_NAME,
    load_company_config,
    server_url,
    valid_model_name,
)
from aios_common import paths, platforms

APP_VERSION = "0.1.0"  # also in pyproject.toml and apps/desktop/package.json
PROFILE_ENV = "AIOS_ENV"
DEV_DIR = Path(__file__).resolve().parents[1] / ".dev"  # services/backend/.dev
REPO_ROOT = Path(__file__).resolve().parents[3]
DEV_DB_KEY = "de" * 32  # 256-bit hex; development data only
TEST_DB_KEY = "00" * 32
DEV_SIGNING_SEED = "5e" * 32  # Ed25519 seed for the dev/test evidence stream; not a secret
# The Company AI server (G-06), set by an operator in a machine-wide file (desktop) or in the dev
# folder (dev). Never in the environment, never with its key (that stays in the OS key store).
OPERATOR_FILE = "operator.json"
COMPANY_CONTEXT_TOKENS = 16384
_OPERATOR_KEYS = {
    "company_ai",
    "company_base_url",
    "company_model_name",
    "company_context_tokens",
}


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
    recovery_pkg: Path  # written at store creation (Recovery Package v1)
    models_dir: Path  # verified GGUF files (models app)
    # Evidence signing seed as 64 hex characters. None -> created in / read from the OS keystore.
    signing_seed: str | None = None
    # Operator flag for the Company provider (lab only). Off: conversations can only run locally.
    company_ai: bool = False
    # llama-server builds (engine_root/cpu, engine_root/vulkan); idle engines are unloaded.
    engine_root: Path = Path()
    engine_idle_unload_s: float = 300.0
    # whisper-server builds (voice_root/cpu, voice_root/vulkan), ADR 0016.
    voice_root: Path = Path()
    # Shown in Settings > Network and the composer while the flag is on. Set by an operator;
    # the API key is never here (it lives in the OS keystore, read only by the gateway).
    company_base_url: str | None = None
    company_model_name: str | None = None
    # How many tokens one conversation may use on the company server (its context per user).
    company_context_tokens: int = COMPANY_CONTEXT_TOKENS
    # company.json, which ``aios-backend company set`` writes and the backend follows while it
    # runs (G-06). None while operator.json decides, and in tests. Never holds a key.
    company_file: Path | None = None
    # Paths reachable without the token. Empty in the shipped app.
    public_paths: frozenset[str] = frozenset()
    docs_enabled: bool = False


def _engine_root() -> Path:
    """Installed: resources/backend/backend.exe next to resources/llama/{cpu,vulkan}/
    (electron-builder.yml). From source: the output of build/llama/build.py."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parents[1] / "llama"
    return REPO_ROOT / "build" / "out" / "llama"


def _voice_root() -> Path:
    """Installed: resources/whisper/{cpu,vulkan}/ next to resources/backend/. From source: the
    output of build/whisper/build.py."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parents[1] / "whisper"
    return REPO_ROOT / "build" / "out" / "whisper"


def _models_dir() -> Path:
    """Installed: ``<install folder>/models``, next to the program on the drive the user chose
    in the installer (backend.exe is ``<install folder>/resources/backend/backend.exe``). The
    installer keeps this folder on update (build/installer/installer.nsh). From source: the
    per-user data folder."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parents[2] / "models"
    return paths.models_dir()


def company_base_url(value: object) -> str | None:
    """The address in ``operator.json``: what the network allowlist accepts (M-22, P-4), and no
    path (AIOS adds ``/v1``). Returned as ``https://host``; None if not acceptable."""
    return server_url(value, allow_path=False)


def company_from_file(path: Path) -> dict[str, Any]:
    """The Company provider settings an operator wrote in ``path`` (G-06), ready for ``Settings``.

    Empty (Company stays off) when the file is missing, unreadable, switches Company off, or holds
    anything unexpected. A file with any other field, an API key in particular, is refused: the
    key lives only in the OS key store (invariant 3)."""
    try:
        data = json.loads(path.read_text("utf-8-sig"))  # Windows editors may add a BOM
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict) or not set(data) <= _OPERATOR_KEYS:
        return {}
    if data.get("company_ai") is not True:
        return {}
    url = company_base_url(data.get("company_base_url"))
    name = data.get("company_model_name")
    tokens = data.get("company_context_tokens", COMPANY_CONTEXT_TOKENS)
    if url is None or not valid_model_name(name):
        return {}
    if type(tokens) is not int or not 2048 <= tokens <= 1_048_576:
        return {}
    return {
        "company_ai": True,
        "company_base_url": url,
        "company_model_name": name,
        "company_context_tokens": tokens,
    }


def with_company(settings: Settings, path: Path | None) -> Settings:
    """Turn the Company provider on from ``company.json`` (G-06), and follow that file while the
    backend runs. When ``operator.json`` already switched Company on, the operator decides and
    ``company.json`` is not read. No valid file: Company stays off."""
    if settings.company_ai:
        return settings
    found = load_company_config(path)
    return replace(
        settings,
        company_ai=found is not None,
        company_base_url=found.base_url if found else None,
        company_model_name=found.model_name if found else None,
        company_context_tokens=found.context_length if found else COMPANY_CONTEXT_TOKENS,
        company_file=path,
    )


def company_file(profile: Profile) -> Path | None:
    """The file ``aios-backend company set`` writes for ``profile``; the test profile has none."""
    if profile is Profile.DESKTOP:
        return paths.data_dir() / FILE_NAME
    if profile is Profile.DEV:
        return DEV_DIR / FILE_NAME
    return None


def load(profile: Profile | str | None = None) -> Settings:
    """Settings for ``profile`` (default: $AIOS_ENV, else dev)."""
    chosen = Profile(profile or os.environ.get(PROFILE_ENV) or Profile.DEV)

    if chosen is Profile.DESKTOP:
        platforms.require_shipped()  # Windows only, until another OS is ported
        paths.ensure_dirs()
        return with_company(
            Settings(
                profile=chosen,
                chats_db=paths.chats_db(),
                db_key=None,
                log_file=paths.logs_dir() / "backend.log",
                backups_dir=paths.data_dir() / "backups",
                engine_root=_engine_root(),
                voice_root=_voice_root(),
                recovery_pkg=paths.recovery_pkg(),
                models_dir=_models_dir(),
                **company_from_file(paths.operator_file()),
            ),
            company_file(chosen),
        )

    if chosen is Profile.DEV:
        DEV_DIR.mkdir(parents=True, exist_ok=True)
        return with_company(
            Settings(
                profile=chosen,
                chats_db=DEV_DIR / "chats.db",
                db_key=DEV_DB_KEY,
                log_file=DEV_DIR / "backend.log",
                backups_dir=DEV_DIR / "backups",
                engine_root=_engine_root(),
                voice_root=_voice_root(),
                recovery_pkg=DEV_DIR / "recovery.pkg",
                models_dir=DEV_DIR / "models",
                signing_seed=DEV_SIGNING_SEED,
                public_paths=frozenset({"/health", "/docs", "/openapi.json"}),
                docs_enabled=True,
                **company_from_file(DEV_DIR / OPERATOR_FILE),
            ),
            company_file(chosen),
        )

    tmp = Path(tempfile.gettempdir()) / "aios-test"
    tmp.mkdir(exist_ok=True)
    return Settings(
        profile=chosen,
        chats_db=tmp / "chats-test.db",
        db_key=TEST_DB_KEY,
        log_file=None,
        backups_dir=tmp / "backups",
        engine_root=_engine_root(),
        voice_root=_voice_root(),
        recovery_pkg=tmp / "recovery-test.pkg",
        models_dir=tmp / "models",
        signing_seed=DEV_SIGNING_SEED,
    )
