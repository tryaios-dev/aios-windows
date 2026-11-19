"""Image and video generation (R-7): what a request may ask for, and the seam to the server.

AIOS makes pictures and short videos on the company's GPU server, through the same safe path as
chat: the media app -> provider router -> gateway -> ``aios_backend.media.company`` -> the server's
media service (``/v1/media/...`` on the company server's address, with the same API key). The UI
never calls a model itself (invariant 1, PR-04).

A job is asynchronous: it is queued on the server, runs (minutes for a video), and its file is
then fetched and kept, encrypted, in chats.db. The server deletes its copy an hour after the job
ends.

The limits below are the server's own (docs/operations/company-server.md); AIOS checks them first
so a wrong request never leaves the computer.
"""

import re
from dataclasses import dataclass
from typing import Annotated, Any, Protocol

from fastapi import Depends, Request

KINDS = ("image", "video")
STATUSES = ("queued", "running", "done", "failed", "cancelled")
PENDING = frozenset({"queued", "running"})
IMAGE_SIZES = frozenset(
    {
        (1024, 1024),
        (1152, 896),
        (896, 1152),
        (1216, 832),
        (832, 1216),
        (1344, 768),
        (768, 1344),
        (512, 512),
    }
)
VIDEO_SIZES = frozenset({(832, 480), (480, 832)})
MIN_FRAMES, MAX_FRAMES = 17, 81  # 4n + 1; 16 frames per second: about 1 to 5 seconds
MAX_PROMPT, MAX_NEGATIVE = 2000, 1000
MAX_SEED = 2**32 - 1
MAX_OUTPUT_BYTES = 60 * 1024 * 1024
MIMES = frozenset({"image/png", "image/jpeg", "image/webp", "video/mp4", "video/webm"})
# Ids the server gives a job: checked before one is put into a URL path.
JOB_ID = re.compile(r"job_[A-Za-z0-9_-]{1,64}")
# Model ids are recorded in evidence (db.outbox): no spaces and no "/".
MODEL_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:+-]{0,63}")
# An error code from the server is passed on only when it is a plain short code.
_CODE = re.compile(r"[a-z][a-z0-9_]{0,47}")


class MediaError(Exception):
    """A media request could not be done. ``code`` is short and content-free; ``status`` is the
    HTTP status the local API answers with."""

    def __init__(self, code: str, status: int = 503) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


def safe_code(value: object, fallback: str) -> str:
    return value if isinstance(value, str) and _CODE.fullmatch(value) else fallback


@dataclass(frozen=True)
class MediaModel:
    id: str
    kind: str  # image | video


@dataclass(frozen=True)
class MediaJob:
    """What to make. Checked with ``check_job`` before it is sent."""

    kind: str
    model: str
    prompt: str
    width: int
    height: int
    seed: int
    negative_prompt: str | None = None
    frames: int | None = None

    def body(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "kind": self.kind,
            "model": self.model,
            "prompt": self.prompt,
            "width": self.width,
            "height": self.height,
            "seed": self.seed,
        }
        if self.negative_prompt:
            out["negative_prompt"] = self.negative_prompt
        if self.kind == "video":
            out["frames"] = self.frames
        return out


def check_job(job: MediaJob) -> None:
    """Refuse what the server would refuse, before anything leaves the computer."""
    if job.kind not in KINDS:
        raise MediaError("invalid_kind", 400)
    if not MODEL_ID.fullmatch(job.model):
        raise MediaError("unknown_model", 400)
    if not job.prompt.strip() or len(job.prompt) > MAX_PROMPT:
        raise MediaError("invalid_prompt", 400)
    if job.negative_prompt is not None and len(job.negative_prompt) > MAX_NEGATIVE:
        raise MediaError("negative_prompt_too_long", 400)
    sizes = IMAGE_SIZES if job.kind == "image" else VIDEO_SIZES
    if (job.width, job.height) not in sizes:
        raise MediaError("invalid_size", 400)
    if not 0 <= job.seed <= MAX_SEED:
        raise MediaError("invalid_seed", 400)
    if job.kind == "video":
        frames = job.frames
        if frames is None or not MIN_FRAMES <= frames <= MAX_FRAMES or (frames - 1) % 4:
            raise MediaError("invalid_frames", 400)
    elif job.frames is not None:
        raise MediaError("invalid_frames", 400)


@dataclass(frozen=True)
class RemoteOutput:
    index: int
    mime: str
    size_bytes: int


@dataclass(frozen=True)
class RemoteJob:
    """A job as the server reports it."""

    id: str
    status: str
    progress: float = 0.0
    position: int | None = None
    outputs: tuple[RemoteOutput, ...] = ()
    error_code: str | None = None

    @classmethod
    def from_json(cls, data: object) -> "RemoteJob":
        """Checked field by field: the server's answer decides a URL path and a stored file."""
        if not isinstance(data, dict):
            raise MediaError("media_bad_answer", 502)
        job_id, status = data.get("id"), data.get("status")
        if not isinstance(job_id, str) or not JOB_ID.fullmatch(job_id) or status not in STATUSES:
            raise MediaError("media_bad_answer", 502)
        progress = data.get("progress")
        position = data.get("position")
        outputs = []
        for item in data.get("outputs") or []:
            if not isinstance(item, dict):
                raise MediaError("media_bad_answer", 502)
            index, mime, size = item.get("index"), item.get("mime"), item.get("bytes")
            if type(index) is not int or not 0 <= index < 16 or mime not in MIMES:
                raise MediaError("media_bad_answer", 502)
            outputs.append(RemoteOutput(index, mime, size if type(size) is int else 0))
        error = data.get("error")
        code = error.get("code") if isinstance(error, dict) else None
        return cls(
            id=job_id,
            status=status,
            progress=min(max(float(progress), 0.0), 1.0)
            if isinstance(progress, int | float)
            else 0.0,
            position=position if type(position) is int and position >= 0 else None,
            outputs=tuple(outputs),
            error_code=safe_code(code, "media_failed") if code is not None else None,
        )

    def to_json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "status": self.status,
            "progress": self.progress,
            "position": self.position,
            "outputs": [
                {"index": o.index, "mime": o.mime, "bytes": o.size_bytes} for o in self.outputs
            ],
            "error": {"code": self.error_code} if self.error_code else None,
        }


def check_job_id(job_id: str) -> str:
    if not JOB_ID.fullmatch(job_id):
        raise MediaError("media_job_not_found", 404)
    return job_id


class MediaSource(Protocol):
    """Who makes pictures and videos: the company server's media service (``company.py``), or the
    provider router in front of it (``aios_backend.providers``). Errors are ``MediaError``."""

    def media_models(self) -> list[MediaModel]: ...

    def media_submit(self, job: MediaJob) -> RemoteJob: ...

    def media_job(self, job_id: str) -> RemoteJob: ...

    def media_output(self, job_id: str, index: int) -> tuple[bytes, str]: ...

    def media_cancel(self, job_id: str) -> None: ...


def get_media(request: Request) -> MediaSource | None:
    source: MediaSource | None = getattr(request.app.state, "media", None)
    return source


Media = Annotated[MediaSource | None, Depends(get_media)]
