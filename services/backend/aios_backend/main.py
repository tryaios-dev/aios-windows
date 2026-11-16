"""App factory for the local API, called only by Electron main with the launch token."""

import asyncio
import logging
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from aios_backend.apps.chat.answers import AnswerSource
from aios_backend.apps.chat.router import router as chat_router
from aios_backend.apps.evidence.router import router as evidence_router
from aios_backend.apps.models.downloads import Downloads
from aios_backend.apps.models.engine import LocalEngine
from aios_backend.apps.models.mirror import ModelMirror
from aios_backend.apps.models.router import router as models_router
from aios_backend.apps.projects.router import router as projects_router
from aios_backend.apps.search.router import router as search_router
from aios_backend.apps.settings import service as settings_service
from aios_backend.apps.settings.router import router as settings_router
from aios_backend.apps.setup.router import router as setup_router
from aios_backend.apps.spike.router import router as spike_router  # SPIKE-D04
from aios_backend.components import Components, ComponentState
from aios_backend.config import Settings
from aios_backend.engine import EngineManager
from aios_backend.errors import AppError
from aios_backend.evidence import process as writer_process
from aios_backend.evidence import pump
from aios_backend.evidence.client import WriterClient
from aios_backend.local import LocalModels
from aios_backend.origin import HuggingFaceOrigin
from aios_backend.routes import VERSION
from aios_backend.routes import router as system_router
from aios_backend.runtime import Generations
from aios_common.asgi_auth import LoopbackTokenMiddleware
from aios_common.logging import file_handler, get_logger, log_event
from db.session import Database
from db.sqlcipher import DatabaseKeyMissing

log = get_logger("api")


def configure_logging(settings: Settings) -> None:
    """Content-free file log (aios_common.logging retention). Access lines are off (paths)."""
    handler: logging.Handler = logging.NullHandler()
    if settings.log_file is not None:
        # Content-free, rotating, and the folder kept within 14 days and 20 MB (M-21).
        handler = file_handler(settings.log_file, "backend")
    for name in ("aios", "uvicorn.error", "alembic"):
        logger = logging.getLogger(name)
        logger.handlers = [handler]
        logger.propagate = False
        logger.setLevel(logging.INFO if name == "aios" else logging.WARNING)
    logging.getLogger("uvicorn.access").disabled = True


def register_error_handlers(app: FastAPI) -> None:
    """Error bodies are a code only; never echo user input back."""

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse({"error": "invalid_request"}, status_code=422)

    @app.exception_handler(HTTPException)
    async def _http(request: Request, exc: HTTPException) -> JSONResponse:
        code = exc.detail if isinstance(exc.detail, str) else "error"
        return JSONResponse({"error": code}, status_code=exc.status_code)

    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse({"error": exc.code}, status_code=exc.status)

    @app.exception_handler(DatabaseKeyMissing)
    async def _locked(request: Request, exc: DatabaseKeyMissing) -> JSONResponse:
        return JSONResponse({"error": "store_locked"}, status_code=503)

    @app.exception_handler(Exception)
    async def _unexpected(request: Request, exc: Exception) -> JSONResponse:
        log_event(log, "unhandled_error", error_code=type(exc).__name__, status=500)
        return JSONResponse({"error": "internal_error"}, status_code=500)


def load_safe_mode(database: Database) -> bool:
    """Saved Safe mode; off if chats.db cannot be read (then nothing else works either)."""
    try:
        with database.session() as session:
            return settings_service.safe_mode_cpu(session)
    except Exception as exc:
        log_event(log, "safe_mode_unreadable", error_code=type(exc).__name__)
        return False


def create_app(
    settings: Settings,
    db: Database | None = None,
    answers: AnswerSource | None = None,
    local_engine: LocalEngine | None = None,
    mirror: ModelMirror | None = None,
    writer: WriterClient | None = None,
    start_writer: bool = False,
    signing_seed: Callable[[], bytes] | None = None,
    local: bool = False,
) -> FastAPI:
    """The seams below are None until their modules exist; the endpoints then answer 409/503.

    ``answers``: what produces chat answers. ``local_engine``: start / benchmark / status for the
    models app (apps/models/engine.py); the process manager itself is ``app.state.engine``.
    ``mirror``: the AIOS model mirror (downloads, catalogue check).
    ``writer``: the evidence writer's API (tests pass one); ``start_writer`` starts
    evidence-writer as a child process instead (backend.exe, ``aios-backend serve``).
    Without either, evidence stays queued in the outbox (pending) and export answers 503.
    ``local``: answer with the installed model through the engine and download models from
    their origin (backend.exe, ``aios-backend serve``); seams passed explicitly still win.
    """
    database = db or Database(settings)
    components = Components()
    local_models: LocalModels | None = None
    engine = EngineManager(
        settings.engine_root,
        settings.models_dir,
        settings.backups_dir.parent / "engine-tmp",  # data folder; models may sit elsewhere
        components,
        idle_unload_s=settings.engine_idle_unload_s,
        model_fn=(lambda: local_models.default_path() if local_models else None) if local else None,
    )
    if local:
        local_models = LocalModels(database, engine, components)
        answers = answers or local_models
        local_engine = local_engine or local_models
        mirror = mirror or HuggingFaceOrigin()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        manager: EngineManager = app.state.engine
        if local_models is not None:
            local_models.bind(asyncio.get_running_loop())
        await manager.set_safe_mode(load_safe_mode(database))  # before any engine can start
        await manager.startup()  # ends orphaned engines (IPC-52), starts the watcher
        child = None
        if app.state.writer is None and start_writer:
            try:
                child = await asyncio.to_thread(writer_process.start, settings, manager.job)
                app.state.writer = child.client
            except writer_process.WriterStartError:
                components.evidence_writer = ComponentState.FAILED
        pumping = None
        if app.state.writer is not None:
            components.evidence_writer = ComponentState.STARTING
            pumping = asyncio.create_task(pump.run(database, app.state.writer, components))
        yield
        if pumping is not None:
            pumping.cancel()
            try:
                await asyncio.to_thread(pump.shutdown_checkpoint, database, app.state.writer)
            except Exception as exc:  # the writer is gone: events stay queued for next time
                log_event(log, "shutdown_checkpoint_failed", error_code=type(exc).__name__)
        if child is not None:
            child.stop()
        await manager.shutdown()
        database.dispose()

    docs = settings.docs_enabled
    app = FastAPI(
        title="AIOS Local API",
        version=VERSION,
        docs_url="/docs" if docs else None,
        redoc_url=None,
        openapi_url="/openapi.json" if docs else None,
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.db = database
    app.state.components = components
    app.state.engine = engine
    app.state.answers = answers
    app.state.generations = Generations()
    app.state.local_engine = local_engine
    app.state.mirror = mirror
    app.state.writer = writer
    # Where restore reads the writer's new signing key to wrap it again: the OS key store, or the
    # fixed development seed. Tests that rotate keys pass their own.
    app.state.signing_seed = signing_seed
    app.state.downloads = Downloads()
    register_error_handlers(app)
    app.include_router(system_router)
    for router in (
        setup_router,
        projects_router,
        chat_router,
        search_router,
        evidence_router,
        settings_router,
        models_router,
    ):
        app.include_router(router)
    app.include_router(spike_router)  # SPIKE-D04: temporary, removed by G-01
    app.add_middleware(LoopbackTokenMiddleware, public_paths=settings.public_paths)
    return app
