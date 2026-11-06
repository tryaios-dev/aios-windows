"""Settings endpoints. D-06: GET/PUT /settings/engine ("Safe mode (CPU)").

Thin like aios_backend.routes: no sqlalchemy, DB driver, subprocess or raw network here.
"""

from fastapi import APIRouter, Request

from aios_backend.apps.settings import service
from aios_backend.apps.settings.schemas import EngineSettings
from aios_backend.engine import EngineManager
from db.session import DbSession

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/engine", summary="Engine settings (Safe mode)")
def get_engine_settings(session: DbSession) -> EngineSettings:
    return service.engine_settings(session)


@router.put("/engine", summary="Change engine settings; Safe mode applies at once and persists")
async def put_engine_settings(
    body: EngineSettings, session: DbSession, request: Request
) -> EngineSettings:
    manager: EngineManager = request.app.state.engine
    return await service.update_engine_settings(session, manager, body)
