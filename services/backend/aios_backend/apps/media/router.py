"""HTTP endpoints for pictures and videos (R-7). Thin: validate, call the service."""

from fastapi import APIRouter, Response, status

from aios_backend.apps.media import service
from aios_backend.apps.media.schemas import (
    MediaContentOut,
    MediaCreate,
    MediaItemOut,
    MediaSavedOut,
    MediaSaveIn,
    MediaStatusOut,
)
from aios_backend.deps import AppSettings
from aios_backend.media import Media
from db.session import DbSession

router = APIRouter(tags=["media"])


@router.get("/media/status", summary="Whether pictures and videos can be made now, and with what")
def media_status(settings: AppSettings, media: Media) -> MediaStatusOut:
    return service.status(settings, media)


@router.get(
    "/projects/{project_id}/media",
    summary="Pictures and videos of a project, newest first (jobs still running are checked)",
)
def list_media(project_id: str, session: DbSession, media: Media) -> list[MediaItemOut]:
    return service.list_items(session, media, project_id)


@router.post(
    "/projects/{project_id}/media",
    status_code=status.HTTP_201_CREATED,
    summary="Make a picture or video on the company server (asks first, see `confirmed`)",
)
def create_media(
    project_id: str, body: MediaCreate, session: DbSession, settings: AppSettings, media: Media
) -> MediaItemOut:
    return service.create(session, settings, media, project_id, body)


@router.get("/media/{media_id}", summary="One picture or video (a running job is checked)")
def get_media(media_id: str, session: DbSession, media: Media) -> MediaItemOut:
    return service.get(session, media, media_id)


@router.get("/media/{media_id}/content", summary="The finished file, to show in the window")
def media_content(media_id: str, session: DbSession) -> MediaContentOut:
    return service.content(session, media_id)


@router.post("/media/{media_id}/cancel", summary="Stop a job that has not finished")
def cancel_media(media_id: str, session: DbSession, media: Media) -> MediaItemOut:
    return service.cancel(session, media, media_id)


@router.post("/media/{media_id}/save", summary="Save a copy of the file where the person chose")
def save_media(media_id: str, body: MediaSaveIn, session: DbSession) -> MediaSavedOut:
    return service.save(session, media_id, body.path)


@router.delete(
    "/media/{media_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a picture or video (a running job is stopped first)",
)
def delete_media(media_id: str, session: DbSession, media: Media) -> Response:
    service.delete(session, media, media_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
