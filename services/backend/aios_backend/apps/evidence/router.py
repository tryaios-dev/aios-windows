"""HTTP endpoints for the evidence view (Evidence tab, Settings > Health)."""

from fastapi import APIRouter

from aios_backend.apps.evidence import service
from aios_backend.apps.evidence.schemas import EvidenceEventOut, EvidenceStatus
from db.session import DbSession

router = APIRouter(tags=["evidence"])


@router.get("/evidence", summary="Recorded events, oldest first (optionally for one project)")
def list_events(session: DbSession, project_id: str | None = None) -> list[EvidenceEventOut]:
    return service.list_events(session, project_id)


@router.get("/projects/{project_id}/evidence", summary="Events of one project")
def project_events(project_id: str, session: DbSession) -> list[EvidenceEventOut]:
    return service.list_events(session, project_id)


@router.get("/evidence/status", summary="Evidence writer state and pending events")
def status(session: DbSession) -> EvidenceStatus:
    return service.status(session)


@router.post("/evidence/export", summary="Export a verifiable bundle (done by the evidence writer)")
def export(session: DbSession) -> None:
    service.export(session)
