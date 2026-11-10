"""HTTP endpoints for settings, the network allowlist, the support bundle and build facts."""

from anyio import from_thread
from fastapi import APIRouter, status

from aios_backend.apps.settings import service
from aios_backend.apps.settings.schemas import (
    AllowlistEntry,
    SettingsOut,
    SettingsPatch,
    SupportBundleIn,
    SupportBundleOut,
    SystemInfo,
    UpdateCheckIn,
)
from aios_backend.deps import AppSettings, Engine
from db.session import DbSession

router = APIRouter(tags=["settings"])


@router.get("/settings", summary="User settings")
def get_settings(session: DbSession) -> SettingsOut:
    return service.get(session)


@router.patch("/settings", summary="Change some settings; omitted fields stay as they are")
def update_settings(body: SettingsPatch, session: DbSession, engine: Engine) -> SettingsOut:
    # Sync route (runs in a worker thread): the process manager lives on the event loop.
    return service.update(
        session,
        body.model_dump(exclude_unset=True),
        apply_safe_mode=lambda on: from_thread.run(engine.set_safe_mode, on),
    )


@router.post(
    "/settings/update-check",
    summary="Record the result of an update check (sent by Electron main's updater)",
)
def record_update_check(body: UpdateCheckIn, session: DbSession) -> SettingsOut:
    return service.record_update_check(session, body.update_available)


@router.get("/system/network", summary="Every host AIOS may connect to")
def network(settings: AppSettings) -> list[AllowlistEntry]:
    return service.allowlist(settings)


@router.post(
    "/system/support-bundle",
    status_code=status.HTTP_201_CREATED,
    summary="Zip the log folder (logs only, never databases or keys)",
)
def support_bundle(body: SupportBundleIn, settings: AppSettings) -> SupportBundleOut:
    return service.support_bundle(settings, body.path)


@router.get("/system/info", summary="Version, data folders and licences (About, Data)")
def system_info(settings: AppSettings) -> SystemInfo:
    return service.info(settings)
