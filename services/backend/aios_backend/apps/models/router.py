"""HTTP endpoints for the model manager. Thin: validate, call the service."""

from fastapi import APIRouter, status

from aios_backend.apps.models import service
from aios_backend.apps.models.schemas import (
    CatalogueOut,
    EngineStatus,
    HardwareOut,
    ImportIn,
    InstalledModelOut,
)
from aios_backend.deps import AppSettings
from db.session import DbSession

router = APIRouter(tags=["models"])


@router.get("/models/catalogue", summary="Models AIOS may install (Model Catalogue v1)")
def get_catalogue() -> CatalogueOut:
    return service.get_catalogue()


@router.get("/models", summary="Installed models")
def list_models(session: DbSession) -> list[InstalledModelOut]:
    return service.list_installed(session)


@router.post(
    "/models/import",
    status_code=status.HTTP_201_CREATED,
    summary="Install a .gguf file from disk if it matches a catalogue entry byte for byte",
)
def import_model(body: ImportIn, session: DbSession, settings: AppSettings) -> InstalledModelOut:
    return service.import_model(session, settings, body.path, body.entry_id)


@router.post(
    "/models/download/{entry_id}",
    summary="Download from the model mirror (not available in this build: 503)",
)
def download(entry_id: str) -> None:
    service.download(entry_id)


@router.delete(
    "/models/{model_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an installed model and its file",
)
def delete_model(model_id: str, session: DbSession, settings: AppSettings) -> None:
    service.delete_model(session, settings, model_id)


@router.get("/system/hardware", summary="This machine's hardware and the recommended tier")
def get_hardware(session: DbSession, settings: AppSettings, refresh: bool = False) -> HardwareOut:
    return service.get_hardware(session, settings, refresh)


@router.get("/engine/status", summary="State of the local engine")
def engine_status(session: DbSession) -> EngineStatus:
    return service.engine_status(session)
