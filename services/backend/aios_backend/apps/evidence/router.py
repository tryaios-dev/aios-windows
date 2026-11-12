"""HTTP endpoints for the evidence view (Evidence tab, event sheet, export, Settings > Data/Health)."""

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Body, Query, Request, status

from aios_backend.apps.evidence import service
from aios_backend.apps.evidence.schemas import (
    Checkpoint,
    EvidenceEventOut,
    EvidenceExportIn,
    EvidenceExportOut,
    EvidenceStatus,
    EvidenceStream,
)
from aios_backend.evidence import pump
from db.session import DbSession

router = APIRouter(tags=["evidence"])


@router.get("/evidence", summary="Recorded events, oldest first (optionally filtered)")
def list_events(
    session: DbSession,
    project_id: Annotated[str | None, Query(max_length=64)] = None,
    event_type: Annotated[list[str] | None, Query(max_length=20)] = None,
    since: Annotated[datetime | None, Query(alias="from")] = None,
    until: Annotated[datetime | None, Query(alias="to")] = None,
    limit: Annotated[int, Query(ge=1, le=1000)] = 1000,
) -> list[EvidenceEventOut]:
    return service.list_events(session, project_id, event_type or (), since, until, limit)


@router.get("/projects/{project_id}/evidence", summary="Events of one project")
def project_events(project_id: str, session: DbSession) -> list[EvidenceEventOut]:
    return service.list_events(session, project_id)


@router.get("/evidence/status", summary="Evidence writer state and pending events")
def get_status(session: DbSession) -> EvidenceStatus:
    return service.status(session)


@router.get("/evidence/stream", summary="This installation's evidence stream and current epoch")
def get_stream(session: DbSession) -> EvidenceStream:
    return service.stream(session)


@router.get("/evidence/checkpoints", summary="Signed checkpoints (made by the evidence writer)")
def get_checkpoints(
    session: DbSession,
    from_seq: Annotated[int | None, Query(ge=0)] = None,
    to_seq: Annotated[int | None, Query(ge=0)] = None,
) -> list[Checkpoint]:
    return service.checkpoints(session, from_seq, to_seq)


@router.get(
    "/evidence/{seq}",
    summary="One event by sequence number (a pending event by its local id)",
)
def get_event(seq: int, session: DbSession) -> EvidenceEventOut:
    return service.get_event(session, seq)


@router.post(
    "/evidence/export",
    status_code=status.HTTP_201_CREATED,
    summary="Export a verifiable bundle for a project or date range (written by the evidence writer)",
)
def export(
    request: Request, session: DbSession, body: Annotated[EvidenceExportIn | None, Body()] = None
) -> EvidenceExportOut:
    writer = request.app.state.writer
    db = request.app.state.db
    return service.export(session, body, writer, lambda: pump.drain(db, writer))
