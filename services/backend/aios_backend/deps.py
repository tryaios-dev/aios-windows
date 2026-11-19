"""FastAPI dependencies shared by app routers (the database ones live in db.session)."""

from dataclasses import replace
from typing import Annotated

from fastapi import Depends, Request

from aios_backend.company_config import current as company_now
from aios_backend.config import Settings
from aios_backend.engine import EngineManager


def get_settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    if settings.company_file is None:
        return settings
    # The Company provider follows company.json while the app runs (G-06): no restart needed.
    found = company_now(settings.company_file)
    live = (found.base_url, found.model_name) if found else (None, None)
    if (found is not None, *live) != (
        settings.company_ai,
        settings.company_base_url,
        settings.company_model_name,
    ):
        settings = replace(
            settings,
            company_ai=found is not None,
            company_base_url=live[0],
            company_model_name=live[1],
        )
        request.app.state.settings = settings
    return settings


AppSettings = Annotated[Settings, Depends(get_settings)]


def get_engine(request: Request) -> EngineManager:
    engine: EngineManager = request.app.state.engine
    return engine


Engine = Annotated[EngineManager, Depends(get_engine)]
