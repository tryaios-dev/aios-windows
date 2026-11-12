"""HTTP endpoints for first-run setup and restore. Thin: validate, call the service."""

from fastapi import APIRouter, Request, status

from aios_backend.apps.setup import service
from aios_backend.apps.setup.schemas import (
    Completed,
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


@router.post("/setup/complete", summary="Finish first run and create the default project")
def complete(session: DbSession) -> Completed:
    return service.complete(session)


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
