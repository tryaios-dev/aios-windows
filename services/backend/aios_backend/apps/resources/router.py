"""HTTP endpoints for Add resources to my AI. Thin: validate, call the service."""

from fastapi import APIRouter, Response, status

from aios_backend.apps.resources import service
from aios_backend.apps.resources.deps import KeyCheck, Models
from aios_backend.apps.resources.schemas import LinkedResourceOut, LinkIn
from db.session import DbSession

router = APIRouter(tags=["resources"])


@router.get("/resources", summary="The cloud AI models linked to this AIOS")
def list_linked(session: DbSession) -> list[LinkedResourceOut]:
    return service.list_linked(session)


@router.post("/resources/{resource_id}/link", summary="Check the API key, store it, link")
def link(
    resource_id: str, body: LinkIn, session: DbSession, check: KeyCheck, models: Models
) -> LinkedResourceOut:
    return service.link(session, resource_id, body.api_key, body.monthly_limit, check, models)


@router.delete(
    "/resources/{resource_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Unlink: remove the key; nothing is sent",
)
def unlink(resource_id: str, session: DbSession) -> Response:
    service.unlink(session, resource_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
