"""HTTP endpoints for first-run setup and restore. Thin: validate, call the service."""

from fastapi import APIRouter, Request, status

from aios_backend.apps.setup import service
from aios_backend.apps.setup.schemas import (
    BackupLocationIn,
    BackupOut,
    Completed,
    RecoveryKeyOut,
    Restored,
    RestoreIn,
    SetupStatus,
    StoreCreated,
)
from aios_backend.deps import AppSettings
from db.session import Db, DbSession

router = APIRouter(tags=["setup"])


@router.get("/setup/status", summary="Whether first run is done and the store exists")
def setup_status(session: DbSession, settings: AppSettings) -> SetupStatus:
    return service.status(session, settings)


@router.post(
    "/setup/store",
    status_code=status.HTTP_201_CREATED,
    summary="Create the store: signing key, recovery key (returned once), recovery.pkg",
)
def create_store(
    request: Request, session: DbSession, db: Db, settings: AppSettings
) -> StoreCreated:
    return service.create_store(session, db, settings, request.app.state.writer)


@router.post(
    "/setup/project",
    summary="Create the default project once (a Setting up step); first run goes on",
)
def create_project(session: DbSession) -> Completed:
    return service.create_project(session)


@router.post("/setup/complete", summary="Finish first run and create the default project")
def complete(session: DbSession) -> Completed:
    return service.complete(session)


@router.post(
    "/recovery-key",
    summary="Create a new recovery key: the keys are wrapped again; the key is returned once",
)
def new_recovery_key(
    request: Request, session: DbSession, db: Db, settings: AppSettings
) -> RecoveryKeyOut:
    return service.new_recovery_key(session, db, settings, request.app.state.writer)


@router.put("/backup/location", summary="Choose the folder backups go to (null: set up later)")
def set_backup_location(
    body: BackupLocationIn, session: DbSession, settings: AppSettings
) -> SetupStatus:
    return service.set_backup_location(session, settings, body.path)


@router.post(
    "/backup", summary="Back up now: a new folder in the chosen location that restore accepts"
)
def backup(request: Request, session: DbSession, db: Db, settings: AppSettings) -> BackupOut:
    return service.backup(session, db, settings, request.app.state.writer)


@router.post("/restore", summary="Restore a backup with its recovery key (all or nothing)")
def restore(request: Request, body: RestoreIn, db: Db, settings: AppSettings) -> Restored:
    return service.restore(
        db,
        settings,
        body.backup_path,
        body.recovery_key,
        body.confirmed,
        writer=request.app.state.writer,
        signing_seed=request.app.state.signing_seed,
    )
