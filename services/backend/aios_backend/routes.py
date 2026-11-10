"""System routes. Each new feature gets its own package in aios_backend/apps/.

Routes stay thin: they take ``db: Db`` / ``session: DbSession`` and never import sqlalchemy.
``/system/status`` only puts together what the apps already report.
"""

from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel

from aios_backend.apps.chat import service as chat
from aios_backend.apps.chat.answers import Answers
from aios_backend.apps.chat.schemas import CompanyStatus
from aios_backend.apps.evidence import service as evidence
from aios_backend.apps.models import service as models
from aios_backend.apps.models.engine import LocalEngineDep
from aios_backend.apps.models.schemas import Build, EngineStateName
from aios_backend.components import Components, ComponentState
from aios_backend.config import APP_VERSION
from aios_backend.deps import AppSettings
from aios_backend.runtime import GenerationsDep
from db.session import Db, DbSession

VERSION = APP_VERSION

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


class EngineSummary(BaseModel):
    state: EngineStateName
    build: Build | None
    loaded_model_id: str | None


class WriterSummary(BaseModel):
    state: Literal["ok", "unavailable"]
    pending: int


class CompanySummary(BaseModel):
    enabled: bool
    reachable: bool
    base_url: str | None
    model_name: str | None


class SystemStatus(BaseModel):
    """Everything the sidebar status dots and Settings > Health show, in one call."""

    backend: str
    database: str
    version: str
    engine: EngineSummary
    writer: WriterSummary
    company: CompanySummary
    generating_conversation_id: str | None


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


@router.get("/system/status", summary="Backend, engine, evidence writer and Company AI state")
def system_status(
    db: Db,
    request: Request,
    session: DbSession,
    settings: AppSettings,
    answers: Answers,
    engine: LocalEngineDep,
    generations: GenerationsDep,
) -> SystemStatus:
    components: Components = request.app.state.components
    eng = models.engine_status(session, engine, generations, components)
    writer = evidence.status(session)
    providers = chat.providers_status(session, settings, answers)
    company: CompanyStatus | None = providers.company
    current = generations.current()
    return SystemStatus(
        backend="ok",
        database=db.status(),
        version=VERSION,
        engine=EngineSummary(state=eng.state, build=eng.build, loaded_model_id=eng.loaded_model_id),
        writer=WriterSummary(state=writer.writer, pending=writer.pending),
        company=CompanySummary(
            enabled=providers.company_enabled,
            reachable=company.reachable if company else False,
            base_url=company.base_url if company else None,
            model_name=company.model_name if company else None,
        ),
        generating_conversation_id=current.conversation_id if current else None,
    )
