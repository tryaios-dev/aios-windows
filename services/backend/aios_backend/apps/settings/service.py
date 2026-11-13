"""Settings rules: defaults, partial updates, the network allowlist (Settings > Network), the
support bundle (Settings > Health) and the build facts (Settings > About and Data).

The allowlist mirrors contracts/network-allowlist/v1/allowlist.json (a test keeps them equal).
It is read-only here: nothing in the backend can add a host.
"""

import os
import re
import zipfile
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from aios_backend import net
from aios_backend.apps.settings import repository as repo
from aios_backend.apps.settings.schemas import (
    AllowlistEntry,
    DataPaths,
    Licence,
    SettingsOut,
    SupportBundleOut,
    SystemInfo,
    UpdateAvailable,
)
from aios_backend.config import APP_VERSION, Settings
from aios_backend.errors import AppError
from db.base import utcnow

EDITABLE = ("update_check", "catalogue_check", "safe_mode_cpu", "default_model_id")

# The allowlist itself lives in aios_backend.net, the one client that enforces it (G-08).
ALLOWLIST = net.ALLOWLIST


def get(session: Session) -> SettingsOut:
    row = repo.load(session)
    update = (
        UpdateAvailable(
            version=row.update_available_version, size_bytes=row.update_available_size or 0
        )
        if row.update_available_version
        else None
    )
    return SettingsOut(
        update_check=row.update_check,
        catalogue_check=row.catalogue_check,
        safe_mode_cpu=row.safe_mode_cpu,
        default_model_id=row.default_model_id,
        last_update_check=row.last_update_check,
        last_catalogue_check=row.last_catalogue_check,
        update_available=update,
        app_version=APP_VERSION,
        catalogue_version=row.catalogue_version,
        schema_version=repo.schema_version(),
    )


def safe_mode_cpu(session: Session) -> bool:
    """Saved Safe mode (CPU), read at start-up before any engine can start. Off by default."""
    row = repo.find(session)
    return bool(row and row.safe_mode_cpu)


def update(
    session: Session,
    patch: dict[str, Any],
    apply_safe_mode: Callable[[bool], None] | None = None,
) -> SettingsOut:
    """Change the fields in ``patch``. Booleans may not be null; the default model may.

    ``apply_safe_mode``: tells the engine's process manager. A Safe mode change is committed
    first, so a crash right after cannot lose a switch-on, then applied at once (D-06)."""
    row = repo.load(session)
    for field in EDITABLE:
        if field not in patch:
            continue
        value = patch[field]
        if value is None and field != "default_model_id":
            raise AppError("invalid_setting", 422)
        setattr(row, field, value)
    repo.save(session)
    if apply_safe_mode is not None and "safe_mode_cpu" in patch:
        session.commit()
        apply_safe_mode(row.safe_mode_cpu)
    return get(session)


def record_update_check(
    session: Session, found: UpdateAvailable | None, manual: bool = False
) -> SettingsOut:
    """Store what the updater found. An automatic check is refused while the user has switched
    the check off; a manual "Check now" is always recorded."""
    row = repo.load(session)
    if not row.update_check and not manual:
        raise AppError("update_check_off", 409)
    row.last_update_check = utcnow()
    row.update_available_version = found.version if found else None
    row.update_available_size = found.size_bytes if found else None
    repo.save(session)
    return get(session)


def allowlist(settings: Settings) -> list[AllowlistEntry]:
    return [
        AllowlistEntry(
            id=flow_id,
            host=host,
            port=port,
            purpose=purpose,
            kind=kind,
            enabled=settings.company_ai if kind == "configured" else True,
        )
        for flow_id, host, port, purpose, kind in ALLOWLIST
    ]


# ------------------------------------------------------------------ support bundle (L-03)
LOG_NAME = re.compile(r"[A-Za-z0-9_.-]+\.log(\.\d{1,3})?")


def _log_files(folder: Path) -> list[Path]:
    """Only log files: in the dev profile the log folder also holds databases."""
    return sorted(p for p in folder.iterdir() if p.is_file() and LOG_NAME.fullmatch(p.name))


def _bundle_target(path_text: str, now: datetime) -> Path:
    path = Path(path_text)
    if not path.is_absolute():
        raise AppError("invalid_path", 400)
    if path.is_dir():
        return path / f"aios-support-bundle-{now:%Y%m%d-%H%M%S}.zip"
    if path.suffix.lower() == ".zip" and path.parent.is_dir():
        return path
    raise AppError("invalid_path", 400)


def support_bundle(settings: Settings, path_text: str) -> SupportBundleOut:
    """A zip of the log folder and nothing more. Logs are content-free; databases never go in."""
    if settings.log_file is None or not settings.log_file.parent.is_dir():
        raise AppError("log_folder_missing", 404)
    now = utcnow()
    target = _bundle_target(path_text, now)
    files = _log_files(settings.log_file.parent)
    tmp = target.with_name(target.name + ".part")
    with zipfile.ZipFile(tmp, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        for file in files:
            bundle.write(file, arcname=f"logs/{file.name}")
    os.replace(tmp, target)
    return SupportBundleOut(
        file_name=target.name,
        path=str(target),
        size_bytes=target.stat().st_size,
        file_count=len(files),
        created_at=now,
    )


# ------------------------------------------------------------------ build facts (About, Data)
# The model rows mirror the bundled Model Catalogue (a test keeps them equal).
LICENCES: list[tuple[str, str, str]] = [
    ("llama.cpp", "Local inference engine", "MIT"),
    ("MiniCPM5 2B", "Model weights (Small)", "Apache-2.0"),
    ("Ornith 1.5 9B", "Model weights (Medium)", "MIT"),
    ("Sage A1.5", "Model weights (Large)", "Apache-2.0"),
    ("Qwen3.8 27B", "Model weights (Large)", "Apache-2.0"),
    ("SQLCipher", "Encrypted database", "BSD-style"),
    ("Electron", "Desktop shell", "MIT"),
]


def info(settings: Settings) -> SystemInfo:
    return SystemInfo(
        app_version=APP_VERSION,
        profile=settings.profile.value,
        schema_version=repo.schema_version(),
        data_paths=DataPaths(
            root=str(settings.chats_db.parent),
            chats_db=str(settings.chats_db),
            recovery_package=str(settings.recovery_pkg),
            models=str(settings.models_dir),
            logs=str(settings.log_file.parent) if settings.log_file else None,
            backups=str(settings.backups_dir),
        ),
        licences=[Licence(name=n, role=r, licence=lic) for n, r, lic in LICENCES],
    )
