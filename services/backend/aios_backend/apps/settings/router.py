"""HTTP endpoints for settings and the network allowlist."""

from fastapi import APIRouter

from aios_backend.apps.settings import service
from aios_backend.apps.settings.schemas import (
    AllowlistEntry,
    SettingsOut,
    SettingsPatch,
    UpdateCheckIn,
)
from aios_backend.deps import AppSettings
from db.session import DbSession

router = APIRouter(tags=["settings"])


@router.get("/settings", summary="User settings")
def get_settings(session: DbSession) -> SettingsOut:
    return service.get(session)


@router.patch("/settings", summary="Change some settings; omitted fields stay as they are")
def update_settings(body: SettingsPatch, session: DbSession) -> SettingsOut:
    return service.update(session, body.model_dump(exclude_unset=True))


@router.post(
    "/settings/update-check",
    summary="Record the result of an update check (sent by Electron main's updater)",
)
def record_update_check(body: UpdateCheckIn, session: DbSession) -> SettingsOut:
    return service.record_update_check(session, body.update_available)


@router.get("/system/network", summary="Every host AIOS may connect to")
def network(settings: AppSettings) -> list[AllowlistEntry]:
    return service.allowlist(settings)
