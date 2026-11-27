"""Video resources linked on the Resources page, made over fal.ai's queue API (Hunyuan Video).

A linked video resource is a second ``MediaSource`` next to the company server's media service
(``company.py``). It is reached like a linked chat resource (``aios_backend.linked``):

* only while it is linked: its API key is in the OS key store, read when a request is made
  (invariant 3), and sent only to fal (``Authorization: Key ...``);
* through the network door, allowing only the queue host, and for the finished file only fal's
  file hosts (``linked_config.FAL_FILE_HOSTS``), on every hop (M-22);
* the person allows every video in a dialog (the media app asks; invariant 2, PR-03);
* logging only an event name and an error code: never the description, the file or the key
  (invariant 6).

The queue API (fal.ai/docs, model endpoints, queue): ``POST {queue}/{owner}/{app}`` starts a
request and answers its ``request_id``; ``GET .../requests/{id}/status`` says ``IN_QUEUE``,
``IN_PROGRESS`` or ``COMPLETED``; ``GET .../requests/{id}`` gives the result, whose ``video.url``
is the file; ``PUT .../requests/{id}/cancel`` stops it. AIOS builds these URLs itself from the
configured endpoint and never follows a URL from an answer except the file's, which must be on a
fal file host.

What the endpoint takes is in ``_input``: the one place to change for another fal video model.

Only the gateway calls this module (invariant 1, PR-04).

Security-relevant path: every change here needs the technical reviewer (.github/CODEOWNERS, B-01).
"""

import re
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any
from urllib.parse import urlsplit

from aios_backend import net
from aios_backend.linked_config import FAL_FILE_HOSTS, FAL_QUEUE, MEDIA, stored_key, valid_key
from aios_backend.media import (
    MAX_OUTPUT_BYTES,
    MIMES,
    MediaError,
    MediaJob,
    MediaModel,
    RemoteJob,
    RemoteOutput,
    check_job,
    check_job_id,
)
from aios_common.logging import get_logger, log_event

TIMEOUT_S = 60.0
CONNECT_S = 10.0
# Job ids AIOS gives a fal request: "job_fal-" and fal's request id. The prefix also tells the
# media router (``MediaSides``) which side a job belongs to.
JOB_PREFIX = "job_fal-"
_REQUEST_ID = re.compile(r"[A-Za-z0-9-]{8,56}")
# A request id that does not exist: asking for its status checks a key without making anything.
_NO_REQUEST = "00000000-0000-0000-0000-000000000000"
# The video shapes the Images & video tab offers (aios_backend.media.VIDEO_SIZES).
_ASPECT = {(832, 480): "16:9", (480, 832): "9:16"}

log = get_logger("media")


def _input(job: MediaJob) -> dict[str, Any]:
    """The request body for the Hunyuan Video endpoint: the description, the variation number and
    the shape, at the endpoint's smallest resolution and length (the cheapest video)."""
    body: dict[str, Any] = {
        "prompt": job.prompt,
        "seed": job.seed,
        "aspect_ratio": _ASPECT.get((job.width, job.height), "16:9"),
        "resolution": "480p",
        "num_frames": "85",
    }
    if job.negative_prompt:
        body["negative_prompt"] = job.negative_prompt
    return body


def _request_id(job_id: str) -> str:
    """fal's request id inside an AIOS job id, or ``media_job_not_found``."""
    rid = check_job_id(job_id).removeprefix(JOB_PREFIX)
    if not job_id.startswith(JOB_PREFIX) or not _REQUEST_ID.fullmatch(rid):
        raise MediaError("media_job_not_found", 404)
    return rid


def file_host_allowed(url: str) -> bool:
    parts = urlsplit(url)
    return parts.scheme == "https" and (parts.hostname or "").lower() in FAL_FILE_HOSTS


class FalMedia:
    """A ``MediaSource`` for the video resources in ``linked_config.MEDIA``. ``secret`` reads a
    resource's key (None: not linked); ``client`` extra HTTP client arguments (tests pass a
    transport)."""

    def __init__(
        self,
        secret: Callable[[str], str | None] = stored_key,
        **client: Any,
    ) -> None:
        self._secret = secret
        self._client = {k: v for k, v in client.items() if v is not None}
        # The file of a finished request, from its result: (request id) -> (url, mime, bytes).
        self._files: dict[str, tuple[str, str, int]] = {}

    # ---- plumbing -----------------------------------------------------------------------------

    def _key(self, resource_id: str) -> str:
        try:
            key = self._secret(resource_id)
        except Exception as exc:  # the key store cannot be used on this machine
            log_event(log, "media_key_unreadable", error_code=type(exc).__name__)
            key = None
        key = key.strip() if key else None
        if not key or not valid_key(key):
            raise self._failed("resource_not_linked", 409)
        return key

    def _linked(self) -> list[str]:
        out = []
        for rid in MEDIA:
            try:
                if self._secret(rid):
                    out.append(rid)
            except Exception as exc:  # the key store cannot be used on this machine
                log_event(log, "media_key_unreadable", error_code=type(exc).__name__)
        return out

    def _failed(self, code: str, status: int) -> MediaError:
        log_event(log, "media_failed", error_code=code)
        return MediaError(code, status)

    @contextmanager
    def _call(self, allow: str = FAL_QUEUE) -> Iterator[Any]:
        """An HTTP client to one host only (the queue, or the file's host)."""
        try:
            with net.outbound_client(
                net.Allowlist(company=lambda: allow),
                timeout=net.Timeout(TIMEOUT_S, connect=CONNECT_S),
                **self._client,
            ) as client:
                yield client
        except MediaError:
            raise
        except (net.HostNotAllowed, net.HTTPError) as exc:
            raise self._failed("media_unreachable", 503) from exc

    def _check(self, resp: Any, missing: str) -> None:
        status = resp.status_code
        if status < 400:
            return
        if status in (401, 403):
            raise self._failed("resource_key_rejected", 502)
        if status == 404:
            raise self._failed(missing, 404 if missing == "media_job_not_found" else 503)
        if status == 429:
            raise self._failed("media_busy", 429)
        if status in (400, 413, 422):
            raise self._failed("media_refused", 400)
        raise self._failed("media_unreachable", 503)

    def _headers(self, key: str) -> dict[str, str]:
        return {"Authorization": f"Key {key}", "Accept": "application/json"}

    def _endpoint(self, resource_id: str) -> str:
        return f"{FAL_QUEUE}/{MEDIA[resource_id]}"

    def _job_resource(self, job_id: str) -> tuple[str, str]:
        """(resource id, fal request id) of an AIOS job id. One video resource today."""
        return next(iter(MEDIA)), _request_id(job_id)

    def _json(self, resp: Any) -> dict[str, Any]:
        try:
            data = resp.json()
        except ValueError as exc:
            raise self._failed("media_bad_answer", 502) from exc
        if not isinstance(data, dict):
            raise self._failed("media_bad_answer", 502)
        return data

    # ---- MediaSource --------------------------------------------------------------------------

    def media_models(self) -> list[MediaModel]:
        """The linked video resources. Nothing is sent: linking already checked the key."""
        return [MediaModel(id=rid, kind="video") for rid in self._linked()]

    def media_submit(self, job: MediaJob) -> RemoteJob:
        check_job(job)
        if job.model not in MEDIA or job.kind != "video":
            raise MediaError("unknown_model", 400)
        key = self._key(job.model)
        with self._call() as client:
            resp = client.post(
                self._endpoint(job.model), json=_input(job), headers=self._headers(key)
            )
            self._check(resp, "media_not_offered")
            data = self._json(resp)
        rid = data.get("request_id")
        if not isinstance(rid, str) or not _REQUEST_ID.fullmatch(rid):
            raise self._failed("media_bad_answer", 502)
        log_event(log, "media_submitted", kind=job.kind, model=job.model)
        position = data.get("queue_position")
        return RemoteJob(
            id=f"{JOB_PREFIX}{rid}",
            status="queued",
            position=position if type(position) is int and position >= 0 else None,
        )

    def media_job(self, job_id: str) -> RemoteJob:
        resource_id, rid = self._job_resource(job_id)
        key = self._key(resource_id)
        base = f"{self._endpoint(resource_id)}/requests/{rid}"
        with self._call() as client:
            resp = client.get(f"{base}/status", headers=self._headers(key))
            self._check(resp, "media_job_not_found")
            data = self._json(resp)
            status = data.get("status")
            if status == "IN_QUEUE":
                position = data.get("queue_position")
                return RemoteJob(
                    id=job_id,
                    status="queued",
                    position=position if type(position) is int and position >= 0 else None,
                )
            if status == "IN_PROGRESS":
                return RemoteJob(id=job_id, status="running", progress=0.5)
            if status != "COMPLETED":
                raise self._failed("media_bad_answer", 502)
            if data.get("error") is not None:  # a failed or cancelled request is COMPLETED too
                return RemoteJob(id=job_id, status="failed", error_code="media_failed")
            resp = client.get(base, headers=self._headers(key))
            if resp.status_code in (400, 422, 500):
                return RemoteJob(id=job_id, status="failed", error_code="media_failed")
            self._check(resp, "media_job_not_found")
            result = self._json(resp)
        found = result.get("video")
        video: dict[str, Any] = found if isinstance(found, dict) else {}
        url = video.get("url")
        if not isinstance(url, str) or not file_host_allowed(url):
            return RemoteJob(id=job_id, status="failed", error_code="media_no_output")
        mime = str(video.get("content_type") or "video/mp4").split(";")[0].strip().lower()
        size = video.get("file_size")
        size = size if type(size) is int and size >= 0 else 0
        if mime not in MIMES or not mime.startswith("video/"):
            mime = "video/mp4"
        self._files[rid] = (url, mime, size)
        return RemoteJob(
            id=job_id, status="done", progress=1.0, outputs=(RemoteOutput(0, mime, size),)
        )

    def media_output(self, job_id: str, index: int) -> tuple[bytes, str]:
        if index != 0:
            raise MediaError("media_job_not_found", 404)
        _, rid = self._job_resource(job_id)
        if rid not in self._files:
            self.media_job(job_id)  # the result names the file
        found = self._files.get(rid)
        if found is None:
            raise MediaError("media_job_not_found", 404)
        url = found[0]
        with self._call(allow=url) as client, client.stream("GET", url) as resp:
            self._check(resp, "media_job_not_found")
            mime = resp.headers.get("content-type", "").split(";")[0].strip().lower()
            if mime not in MIMES or not mime.startswith("video/"):
                mime = found[1]
            data = bytearray()
            for chunk in resp.iter_bytes():
                data += chunk
                if len(data) > MAX_OUTPUT_BYTES:
                    raise self._failed("media_output_too_large", 502)
        self._files.pop(rid, None)
        return bytes(data), mime

    def media_cancel(self, job_id: str) -> None:
        resource_id, rid = self._job_resource(job_id)
        key = self._key(resource_id)
        url = f"{self._endpoint(resource_id)}/requests/{rid}/cancel"
        with self._call() as client:
            resp = client.put(url, headers=self._headers(key))
            if resp.status_code == 400:  # ALREADY_COMPLETED: nothing to stop
                return
            self._check(resp, "media_job_not_found")


def check(resource_id: str, key: str, **client: Any) -> str | None:
    """Whether fal accepts ``key``, before it is stored: the status of a request that does not
    exist is asked, so nothing is made or paid for. None if the key works, else a short code."""
    endpoint = MEDIA[resource_id]
    try:
        with net.outbound_client(
            net.Allowlist(company=lambda: FAL_QUEUE),
            timeout=net.Timeout(15.0, connect=CONNECT_S),
            **{k: v for k, v in client.items() if v is not None},
        ) as http:
            resp = http.get(
                f"{FAL_QUEUE}/{endpoint}/requests/{_NO_REQUEST}/status",
                headers={"Authorization": f"Key {key}", "Accept": "application/json"},
            )
    except (net.HostNotAllowed, net.HTTPError):
        return "resource_unreachable"
    if resp.status_code in (401, 403):
        return "resource_key_rejected"
    if resp.status_code >= 500:
        return "resource_unreachable"
    return None


class MediaSides:
    """The gateway's ``MediaSource``: the company server's media service and the linked video
    resources side by side. A job goes to the side its model (or its job id) belongs to."""

    def __init__(self, company: Any | None, linked: FalMedia) -> None:
        self._company = company
        self._linked = linked

    def _side(self, model_or_job: str) -> Any:
        if model_or_job in MEDIA or model_or_job.startswith(JOB_PREFIX):
            return self._linked
        if self._company is None:
            raise MediaError("media_unavailable", 503)
        return self._company

    def media_models(self) -> list[MediaModel]:
        linked = self._linked.media_models()
        if self._company is None:
            if not linked:
                raise MediaError("media_unavailable", 503)
            return linked
        try:
            company: list[MediaModel] = self._company.media_models()
        except MediaError:
            if linked:  # the linked videos can still be made
                return linked
            raise
        return [*company, *linked]

    def media_submit(self, job: MediaJob) -> RemoteJob:
        result: RemoteJob = self._side(job.model).media_submit(job)
        return result

    def media_job(self, job_id: str) -> RemoteJob:
        result: RemoteJob = self._side(job_id).media_job(job_id)
        return result

    def media_output(self, job_id: str, index: int) -> tuple[bytes, str]:
        result: tuple[bytes, str] = self._side(job_id).media_output(job_id, index)
        return result

    def media_cancel(self, job_id: str) -> None:
        self._side(job_id).media_cancel(job_id)
