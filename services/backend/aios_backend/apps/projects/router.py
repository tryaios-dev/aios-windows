"""HTTP endpoints for projects (MVP 9.3). Thin: validate, call the service, return a schema."""

from fastapi import APIRouter, status

from aios_backend.apps.projects import service
from aios_backend.apps.projects.schemas import (
    CompanyAi,
    ExportIn,
    ExportOut,
    ImportIn,
    ImportOut,
    PackageRecordOut,
    ProjectCreate,
    ProjectOut,
    ProjectPatch,
    Reclassify,
    ReclassifyOut,
)
from aios_backend.deps import AppSettings
from db.session import DbSession

router = APIRouter(tags=["projects"])


@router.get("/projects", summary="All projects, newest first (optionally only archived or active)")
def list_projects(session: DbSession, archived: bool | None = None) -> list[ProjectOut]:
    return [ProjectOut.model_validate(p) for p in service.list_projects(session, archived)]


@router.post("/projects", status_code=status.HTTP_201_CREATED, summary="Create a project")
def create_project(body: ProjectCreate, session: DbSession) -> ProjectOut:
    return ProjectOut.model_validate(
        service.create_project(session, body.name, body.classification)
    )


@router.get("/projects/{project_id}", summary="One project")
def get_project(project_id: str, session: DbSession) -> ProjectOut:
    return ProjectOut.model_validate(service.get_project(session, project_id))


@router.patch("/projects/{project_id}", summary="Rename or archive a project")
def update_project(project_id: str, body: ProjectPatch, session: DbSession) -> ProjectOut:
    project = service.update_project(session, project_id, body.name, body.archived)
    return ProjectOut.model_validate(project)


@router.delete(
    "/projects/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a project and everything in it",
)
def delete_project(project_id: str, session: DbSession) -> None:
    service.delete_project(session, project_id)


@router.post(
    "/projects/{project_id}/reclassify",
    summary="Change classification; lowering creates a reviewed copy",
)
def reclassify(project_id: str, body: Reclassify, session: DbSession) -> ReclassifyOut:
    return service.reclassify(session, project_id, body.to)


@router.put("/projects/{project_id}/company-ai", summary="Use Company AI for new conversations")
def set_company_ai(
    project_id: str, body: CompanyAi, session: DbSession, settings: AppSettings
) -> ProjectOut:
    project = service.set_company_ai(session, settings, project_id, body.enabled, body.confirmed)
    return ProjectOut.model_validate(project)


@router.post("/projects/{project_id}/export", summary="Write a Project Package v1 file")
def export_project(project_id: str, body: ExportIn, session: DbSession) -> ExportOut:
    return service.export_project(session, project_id, body.path, body.confirmed)


@router.post(
    "/projects/import",
    status_code=status.HTTP_201_CREATED,
    summary="Import a Project Package v1 file (all or nothing)",
)
def import_project(body: ImportIn, session: DbSession) -> ImportOut:
    return service.import_project(session, body.path)


@router.get("/projects/{project_id}/packages", summary="Export and import history, newest first")
def package_history(project_id: str, session: DbSession) -> list[PackageRecordOut]:
    return service.package_history(session, project_id)
