"""HTTP endpoints for the model manager, downloads, hardware, benchmark and engine. Thin."""

from typing import Annotated

from fastapi import APIRouter, Body, status

from aios_backend.apps.models import service
from aios_backend.apps.models.downloads import DownloadsDep
from aios_backend.apps.models.engine import Engine
from aios_backend.apps.models.mirror import Mirror
from aios_backend.apps.models.schemas import (
    BenchmarkOut,
    CatalogueCheckOut,
    CatalogueOut,
    DownloadStart,
    DownloadState,
    EngineStatus,
    HardwareOut,
    ImportIn,
    InstalledModelDetail,
    InstalledModelOut,
    ModelChoiceIn,
)
from aios_backend.deps import AppSettings
from aios_backend.runtime import GenerationsDep
from db.session import Db, DbSession

router = APIRouter(tags=["models"])

OptionalChoice = Annotated[ModelChoiceIn | None, Body()]


# ------------------------------------------------------------------ catalogue
@router.get("/models/catalogue", summary="Models AIOS may install (Model Catalogue v1)")
def get_catalogue() -> CatalogueOut:
    return service.get_catalogue()


@router.post(
    "/models/catalogue/check",
    summary="Ask the model mirror which catalogue it offers and record the check",
)
def check_catalogue(session: DbSession, mirror: Mirror) -> CatalogueCheckOut:
    return service.check_catalogue(session, mirror)


# ------------------------------------------------------------------ downloads
@router.get("/models/downloads", summary="Downloads in progress, paused, failed or done")
def list_downloads(db: Db, settings: AppSettings, downloads: DownloadsDep) -> list[DownloadState]:
    return service.list_downloads(db, settings, downloads)


@router.post(
    "/models/downloads",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Start downloading a catalogue model from the model mirror",
)
def start_download(
    body: DownloadStart,
    session: DbSession,
    db: Db,
    settings: AppSettings,
    mirror: Mirror,
    downloads: DownloadsDep,
) -> DownloadState:
    return service.start_download(session, settings, db, mirror, downloads, body.entry_id)


@router.post(
    "/models/download/{entry_id}",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Deprecated alias of POST /models/downloads",
    deprecated=True,
)
def start_download_alias(
    entry_id: str,
    session: DbSession,
    db: Db,
    settings: AppSettings,
    mirror: Mirror,
    downloads: DownloadsDep,
) -> DownloadState:
    return service.start_download(session, settings, db, mirror, downloads, entry_id)


@router.get("/models/downloads/{entry_id}", summary="One download")
def get_download(
    entry_id: str, db: Db, settings: AppSettings, downloads: DownloadsDep
) -> DownloadState:
    return service.get_download(db, settings, downloads, entry_id)


@router.post("/models/downloads/{entry_id}/pause", summary="Pause a download; the part is kept")
def pause_download(
    entry_id: str, db: Db, settings: AppSettings, downloads: DownloadsDep
) -> DownloadState:
    return service.pause_download(db, settings, downloads, entry_id)


@router.post(
    "/models/downloads/{entry_id}/resume",
    summary="Resume a paused download where it stopped, or retry a failed one",
)
def resume_download(
    entry_id: str, db: Db, settings: AppSettings, mirror: Mirror, downloads: DownloadsDep
) -> DownloadState:
    return service.resume_download(settings, db, mirror, downloads, entry_id)


@router.delete(
    "/models/downloads/{entry_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Cancel a download and delete the partial file",
)
def cancel_download(entry_id: str, db: Db, settings: AppSettings, downloads: DownloadsDep) -> None:
    service.cancel_download(db, settings, downloads, entry_id)


# ------------------------------------------------------------------ installed models
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


@router.get("/models/{model_id}", summary="One installed model with its verification checks")
def get_model(model_id: str, session: DbSession) -> InstalledModelDetail:
    return service.get_model(session, model_id)


@router.delete(
    "/models/{model_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete an installed model and its file",
)
def delete_model(model_id: str, session: DbSession, settings: AppSettings) -> None:
    service.delete_model(session, settings, model_id)


# ------------------------------------------------------------------ hardware and benchmark
@router.get("/system/hardware", summary="This machine's hardware, recommended tier, last benchmark")
def get_hardware(session: DbSession, settings: AppSettings, refresh: bool = False) -> HardwareOut:
    return service.get_hardware(session, settings, refresh)


@router.post("/system/benchmark", summary="Run a short benchmark on the local engine")
def run_benchmark(
    session: DbSession, engine: Engine, generations: GenerationsDep, body: OptionalChoice = None
) -> BenchmarkOut:
    return service.run_benchmark(session, engine, generations, body.model_id if body else None)


# ------------------------------------------------------------------ engine
@router.get("/engine/status", summary="State of the local engine")
def engine_status(session: DbSession, engine: Engine, generations: GenerationsDep) -> EngineStatus:
    return service.engine_status(session, engine, generations)


@router.post("/engine/start", summary="Start the local engine and load a model")
def start_engine(
    session: DbSession, engine: Engine, generations: GenerationsDep, body: OptionalChoice = None
) -> EngineStatus:
    return service.start_engine(session, engine, generations, body.model_id if body else None)


@router.post(
    "/engine/fallback/acknowledge",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Hide the GPU-to-CPU fallback notice",
)
def acknowledge_fallback(session: DbSession, engine: Engine) -> None:
    service.acknowledge_fallback(session, engine)
