"""FastAPI dependencies shared by app routers (the database ones live in db.session)."""

from typing import Annotated

from fastapi import Depends, Request

from aios_backend.config import Settings


def get_settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


AppSettings = Annotated[Settings, Depends(get_settings)]
