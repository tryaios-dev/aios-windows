"""Pictures and videos (R-7): make, follow, keep, show, save, cancel, delete.

A picture or video is made on the company's GPU server, so its description leaves the computer.
That follows the Company rule (invariant 2, PR-03): only while a company server is set up, and only
after the person agreed in a dialog, unless the project already uses the company server (agreed
when that was switched on).

A job runs on the server; AIOS asks how it is going whenever the item is read (the window asks
every few seconds while one runs), fetches the finished file and keeps it encrypted in chats.db.
The server deletes its copy an hour after the job ends; a job that is gone by then is marked
``media_expired``.

Evidence records ids, the kind, the model, the size and the outcome: never the description or the
file (SR-07).
"""

import base64
import secrets
import uuid
from pathlib import Path

from sqlalchemy.orm import Session

from aios_backend.apps.media import repository as repo
from aios_backend.apps.media.models import MediaItem
from aios_backend.apps.media.schemas import (
    MediaContentOut,
    MediaCreate,
    MediaItemOut,
    MediaModelOut,
    MediaSavedOut,
    MediaStatusOut,
)
from aios_backend.config import Settings
from aios_backend.errors import AppError, not_found
from aios_backend.media import (
    MAX_SEED,
    PENDING,
    MediaError,
    MediaJob,
    MediaSource,
    check_job,
    safe_code,
)
from db.base import utcnow

# Jobs still running are checked when a list is read; at most this many per read, newest first.
REFRESH_PER_LIST = 5
EXTENSIONS = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/webm": "webm",
}


def _out(item: MediaItem) -> MediaItemOut:
    return MediaItemOut(
        id=item.id,
        project_id=item.project_id,
        kind="video" if item.kind == "video" else "image",
        model=item.model,
        prompt=item.prompt,
        negative_prompt=item.negative_prompt,
        width=item.width,
        height=item.height,
        frames=item.frames,
        seed=item.seed,
        status=item.status,
        progress=item.progress,
        position=item.position,
        error_code=item.error_code,
        mime=item.mime,
        size_bytes=item.size_bytes,
        created_at=item.created_at,
        finished_at=item.finished_at,
    )


def _app_error(exc: MediaError) -> AppError:
    return AppError(exc.code, exc.status)


def _item(session: Session, media_id: str) -> MediaItem:
    item = repo.get(session, media_id)
    if item is None:
        raise not_found("media")
    return item


# ------------------------------------------------------------------ what can be made
def status(settings: Settings, media: MediaSource | None) -> MediaStatusOut:
    if not settings.company_ai:
        return MediaStatusOut(available=False, reason="company_provider_disabled", models=[])
    if media is None:
        return MediaStatusOut(available=False, reason="media_unavailable", models=[])
    try:
        models = media.media_models()
    except MediaError as exc:
        return MediaStatusOut(available=False, reason=exc.code, models=[])
    return MediaStatusOut(
        available=bool(models),
        reason=None if models else "media_not_offered",
        models=[MediaModelOut(id=m.id, kind=m.kind) for m in models],
    )


# ------------------------------------------------------------------ make
def create(
    session: Session,
    settings: Settings,
    media: MediaSource | None,
    project_id: str,
    body: MediaCreate,
) -> MediaItemOut:
    project = repo.get_project(session, project_id)
    if project is None:
        raise not_found("project")
    if project.archived:
        raise AppError("project_archived", 409)
    if not settings.company_ai:
        raise AppError("company_provider_disabled", 409)
    if media is None:
        raise AppError("media_unavailable", 503)
    asked_now = not project.company_ai_enabled
    if asked_now and not body.confirmed:
        raise AppError("confirmation_required", 400)
    job = MediaJob(
        kind=body.kind,
        model=body.model,
        prompt=body.prompt,
        negative_prompt=body.negative_prompt or None,
        width=body.width,
        height=body.height,
        seed=body.seed if body.seed is not None else secrets.randbelow(MAX_SEED + 1),
        frames=body.frames,
    )
    try:
        check_job(job)  # nothing leaves the computer for a request the server would refuse
        remote = media.media_submit(job)
    except MediaError as exc:
        raise _app_error(exc) from exc
    item = MediaItem(
        id=str(uuid.uuid4()),
        project_id=project_id,
        kind=job.kind,
        model=job.model,
        prompt=job.prompt,
        negative_prompt=job.negative_prompt,
        width=job.width,
        height=job.height,
        frames=job.frames,
        seed=job.seed,
        status=remote.status if remote.status in PENDING else "queued",
        progress=remote.progress,
        position=remote.position,
        remote_job_id=remote.id,
    )
    repo.add(session, item)
    project.updated_at = utcnow()
    if asked_now:
        repo.record_event(
            session,
            "disclosure_confirmed",
            project_id=project_id,
            body={
                "project_id": project_id,
                "provider": "company",
                "purpose": "media",
                "classification": project.classification,
            },
        )
    body_fields: dict[str, str | int | bool | None] = {
        "media_id": item.id,
        "project_id": project_id,
        "kind": item.kind,
        "model": item.model,
        "width": item.width,
        "height": item.height,
        "provider": "company",
    }
    if item.frames is not None:
        body_fields["frames"] = item.frames
    repo.record_event(session, "media_requested", project_id=project_id, body=body_fields)
    if remote.status not in PENDING:  # the server answered with a finished job at once
        _refresh(session, media, item)
    return _out(item)


# ------------------------------------------------------------------ follow
def _finish(session: Session, item: MediaItem, outcome: str, error: str | None = None) -> None:
    item.status = outcome
    item.error_code = error
    item.position = None
    item.finished_at = utcnow()
    if outcome == "done":
        item.progress = 1.0
    body: dict[str, str | int | bool | None] = {
        "media_id": item.id,
        "kind": item.kind,
        "model": item.model,
        "status": outcome,
    }
    if item.size_bytes is not None:
        body["size_bytes"] = item.size_bytes
    if error is not None:
        body["error_code"] = error
    repo.record_event(session, "media_completed", project_id=item.project_id, body=body)
    session.flush()


def _refresh(session: Session, media: MediaSource | None, item: MediaItem) -> None:
    """Ask the server how a job is going; fetch the file when it is done. A server that cannot
    be reached now leaves the item as it was (it is asked again next time)."""
    if item.status not in PENDING or not item.remote_job_id or media is None:
        return
    try:
        remote = media.media_job(item.remote_job_id)
    except MediaError as exc:
        if exc.code == "media_job_not_found":
            _finish(session, item, "failed", "media_expired")
        return
    item.progress, item.position = remote.progress, remote.position
    if remote.status in PENDING:
        item.status = remote.status
        session.flush()
        return
    if remote.status == "cancelled":
        _finish(session, item, "cancelled")
        return
    if remote.status == "failed":
        _finish(session, item, "failed", safe_code(remote.error_code, "media_failed"))
        return
    if not remote.outputs:
        _finish(session, item, "failed", "media_no_output")
        return
    try:
        data, mime = media.media_output(item.remote_job_id, remote.outputs[0].index)
    except MediaError as exc:
        if exc.code == "media_job_not_found":
            _finish(session, item, "failed", "media_expired")
        elif exc.status < 500 or exc.code in ("media_output_too_large", "media_bad_answer"):
            _finish(session, item, "failed", exc.code)
        return
    if mime not in EXTENSIONS or not mime.startswith(item.kind):
        _finish(session, item, "failed", "media_bad_answer")
        return
    item.data, item.mime, item.size_bytes = data, mime, len(data)
    _finish(session, item, "done")


def list_items(session: Session, media: MediaSource | None, project_id: str) -> list[MediaItemOut]:
    if repo.get_project(session, project_id) is None:
        raise not_found("project")
    found = list(repo.items(session, project_id))
    for item in [i for i in found if i.status in PENDING][:REFRESH_PER_LIST]:
        _refresh(session, media, item)
    return [_out(i) for i in found]


def get(session: Session, media: MediaSource | None, media_id: str) -> MediaItemOut:
    item = _item(session, media_id)
    _refresh(session, media, item)
    return _out(item)


# ------------------------------------------------------------------ show, save
def content(session: Session, media_id: str) -> MediaContentOut:
    item = _item(session, media_id)
    if item.status != "done" or item.data is None or item.mime is None:
        raise AppError("media_not_ready", 409)
    return MediaContentOut(
        id=item.id, mime=item.mime, data_base64=base64.b64encode(item.data).decode("ascii")
    )


def save(session: Session, media_id: str, path_text: str) -> MediaSavedOut:
    """A copy where the person chose in the save dialog (this one leaves the encrypted store)."""
    item = _item(session, media_id)
    if item.status != "done" or item.data is None or item.mime is None:
        raise AppError("media_not_ready", 409)
    path = Path(path_text)
    if not path.is_absolute() or not path.parent.is_dir() or path.is_dir():
        raise AppError("invalid_path", 400)
    extension = EXTENSIONS[item.mime]
    if path.suffix.lower() != f".{extension}":
        path = path.with_name(f"{path.name}.{extension}")
    path.write_bytes(item.data)
    repo.record_event(
        session,
        "media_exported",
        project_id=item.project_id,
        body={"media_id": item.id, "kind": item.kind, "size_bytes": len(item.data)},
    )
    return MediaSavedOut(path=str(path), size_bytes=len(item.data))


# ------------------------------------------------------------------ stop, delete
def _stop_remote(media: MediaSource | None, item: MediaItem) -> None:
    if item.status in PENDING and item.remote_job_id and media is not None:
        try:
            media.media_cancel(item.remote_job_id)
        except MediaError as exc:
            if exc.code != "media_job_not_found":
                raise _app_error(exc) from exc


def cancel(session: Session, media: MediaSource | None, media_id: str) -> MediaItemOut:
    item = _item(session, media_id)
    if item.status not in PENDING:
        return _out(item)
    _stop_remote(media, item)
    _finish(session, item, "cancelled")
    return _out(item)


def delete(session: Session, media: MediaSource | None, media_id: str) -> None:
    item = _item(session, media_id)
    try:
        _stop_remote(media, item)
    except AppError:
        pass  # the server cannot be reached: its copy is deleted there within the hour anyway
    project_id, kind = item.project_id, item.kind
    repo.delete(session, item)
    repo.record_event(
        session,
        "media_deleted",
        project_id=project_id,
        body={"media_id": media_id, "kind": kind},
    )
