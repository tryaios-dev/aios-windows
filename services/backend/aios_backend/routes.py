"""System routes. Each new feature gets its own package in aios_backend/apps/.

Routes stay thin: they take ``db: Db`` / ``session: DbSession`` and never import sqlalchemy.
"""

from fastapi import APIRouter, Request
from pydantic import BaseModel

from aios_backend.components import Components, ComponentState
from db.session import Db

VERSION = "0.1.0"

router = APIRouter(tags=["system"])


class Health(BaseModel):
    backend: str
    database: str  # ok | locked | error
    engine: ComponentState
    engine_build: str | None  # cpu | vulkan while starting or running
    engine_model: str | None  # model file name while starting or running
    engine_cpu_fallback: bool  # GPU build failed this session; running on CPU
    engine_idle_unloaded: bool  # unloaded after the idle period; the next message restarts it
    evidence_writer: ComponentState
    version: str


@router.get("/health", summary="Backend, database, engine and evidence writer status")
def health(db: Db, request: Request) -> Health:
    components: Components = request.app.state.components
    return Health(
        backend="ok",
        database=db.status(),
        engine=components.engine,
        engine_build=components.engine_build,
        engine_model=components.engine_model,
        engine_cpu_fallback=components.engine_cpu_fallback,
        engine_idle_unloaded=components.engine_idle_unloaded,
        evidence_writer=components.evidence_writer,
        version=VERSION,
    )
