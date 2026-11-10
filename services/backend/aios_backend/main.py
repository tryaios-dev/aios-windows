"""App factory for the local API, called only by Electron main with the launch token."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from aios_backend.apps.chat.answers import AnswerSource
from aios_backend.apps.chat.router import router as chat_router
from aios_backend.apps.evidence.router import router as evidence_router
from aios_backend.apps.models.router import router as models_router
from aios_backend.apps.projects.router import router as projects_router
from aios_backend.apps.search.router import router as search_router
from aios_backend.apps.settings import service as settings_service
from aios_backend.apps.settings.router import router as settings_router
from aios_backend.apps.setup.router import router as setup_router
from aios_backend.apps.spike.router import router as spike_router  # SPIKE-D04
from aios_backend.components import Components
from aios_backend.config import Settings
from aios_backend.engine import EngineManager
from aios_backend.errors import AppError
from aios_backend.routes import VERSION
from aios_backend.routes import router as system_router
from aios_common.asgi_auth import LoopbackTokenMiddleware
from aios_common.logging import ContentFreeFormatter, get_logger, log_event
from db.session import Database
from db.sqlcipher import DatabaseKeyMissing

log = get_logger("api")


def configure_logging(settings: Settings) -> None:
    """Content-free file log, 5 MB x 4 files. Access lines are off (they carry paths)."""
    handler: logging.Handler = logging.NullHandler()
    if settings.log_file is not None:
        settings.log_file.parent.mkdir(parents=True, exist_ok=True)
        handler = RotatingFileHandler(
            settings.log_file, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
        )
        handler.setFormatter(ContentFreeFormatter())
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
    settings: Settings, db: Database | None = None, answers: AnswerSource | None = None
) -> FastAPI:
    """``answers``: what produces chat answers. None until the local model module exists."""
    database = db or Database(settings)
    components = Components()
    engine = EngineManager(
        settings.engine_root,
        settings.models_dir,
        settings.models_dir.parent / "engine-tmp",
        components,
        idle_unload_s=settings.engine_idle_unload_s,
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        manager: EngineManager = app.state.engine
        await manager.set_safe_mode(load_safe_mode(database))  # before any engine can start
        await manager.startup()  # ends orphaned engines (IPC-52), starts the watcher
        yield
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
