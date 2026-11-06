"""Settings rules: defaults, partial updates, and the network allowlist shown in Settings > Network.

The allowlist mirrors contracts/network-allowlist/v1/allowlist.json (a test keeps them equal).
It is read-only here: nothing in the backend can add a host.
"""

from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from aios_backend.apps.settings import repository as repo
from aios_backend.apps.settings.schemas import AllowlistEntry, SettingsOut, UpdateAvailable
from aios_backend.config import APP_VERSION, Settings
from aios_backend.errors import AppError
from db.base import utcnow

EDITABLE = ("update_check", "catalogue_check", "safe_mode_cpu", "default_model_id")

# (id, host, port, purpose, kind). Hostnames are placeholders until B-06 records the real ones.
ALLOWLIST: list[tuple[str, str, int, str, str]] = [
    (
        "model-mirror",
        "models.example.eu",
        443,
        "Model mirror (downloads you start, catalogue check)",
        "fixed",
    ),
    (
        "update-feed",
        "updates.example.eu",
        443,
        "Signed update feed (at start, at most once a day)",
        "fixed",
    ),
    (
        "company-server",
        "configured",
        443,
        "Company AI server (only while the provider flag is on)",
        "configured",
    ),
]


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


def record_update_check(session: Session, found: UpdateAvailable | None) -> SettingsOut:
    """Store what the updater found. Ignored while the user has switched the check off."""
    row = repo.load(session)
    if not row.update_check:
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
