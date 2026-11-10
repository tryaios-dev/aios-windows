"""HTTP endpoint for search (Ctrl K and the search page)."""

from typing import Annotated, Literal

from fastapi import APIRouter, Query

from aios_backend.apps.search import service
from aios_backend.apps.search.schemas import SearchHit
from db.session import DbSession

router = APIRouter(tags=["search"])


@router.get("/search", summary="Messages containing the query, newest first")
def search(
    session: DbSession,
    q: Annotated[str, Query(max_length=200)] = "",
    project_id: Annotated[str | None, Query(max_length=64)] = None,
    role: Literal["user", "assistant"] | None = None,
    include_archived: bool = True,
    limit: Annotated[int, Query(ge=1, le=200)] = 60,
) -> list[SearchHit]:
    return service.search(session, q, project_id, role, include_archived, limit)
