"""System routes. Each new feature gets its own package in aios_backend/apps/.

Routes stay thin: they take ``db: Db`` / ``session: DbSession`` and never import sqlalchemy.
"""

from fastapi import APIRouter
from pydantic import BaseModel

from db.session import Db

VERSION = "0.1.0"

router = APIRouter(tags=["system"])


class Health(BaseModel):
    backend: str
    database: str  # ok | locked | error
    version: str


@router.get("/health", summary="Backend and database are up")
def health(db: Db) -> Health:
    return Health(backend="ok", database=db.status(), version=VERSION)
