"""The company server's media service (R-7): pictures and short videos from its GPU.

The service sits on the same address as the company's chat API, under ``/v1/media/``, and checks
the same API key. So it is reached exactly like the Company provider (``aios_backend.company``):

* only while Company is configured (``operator.json`` or ``company.json``), at that server's host;
* through the network door, which allows only that host, on every hop (M-22, P-4);
* with the API key from the OS key store, read when the request is made (invariant 3);
* logging only an event name and an error code: never the prompt, a picture or the key
  (invariant 6).

Only the gateway calls this module (invariant 1, PR-04).

Security-relevant path: every change here needs the technical reviewer (.github/CODEOWNERS, B-01).
"""

import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any
from urllib.parse import urlsplit

from aios_backend import net
from aios_backend.company import HEADERS, KEY_NAME, configured, valid_key
from aios_backend.company_config import CompanyConfig
from aios_backend.config import Settings
from aios_backend.media import (
    KINDS,
    MAX_OUTPUT_BYTES,
    MIMES,
    MODEL_ID,
    MediaError,
    MediaJob,
    MediaModel,
    RemoteJob,
    check_job,
    check_job_id,
    safe_code,
)
from aios_common.keystore import get_secret
from aios_common.logging import get_logger, log_event

PATH = "/v1/media"
TIMEOUT_S = 60.0  # one request; a long job is followed with short status requests
CONNECT_S = 10.0
MODELS_TTL_S = 30.0  # the model list is not asked again for this long

log = get_logger("media")


def _stored_key() -> str | None:
    return get_secret(KEY_NAME)


class CompanyMedia:
    """A ``MediaSource`` for the company server. ``config`` returns the server to use now (None:
    Company is off); ``secret`` the API key; ``client`` extra arguments for the HTTP client (tests
    pass a transport)."""

    def __init__(
        self,
        config: Callable[[], CompanyConfig | None],
        secret: Callable[[], str | None] = _stored_key,
        clock: Callable[[], float] = time.monotonic,
        **client: Any,
    ) -> None:
        self._config = config
        self._secret = secret
        self._clock = clock
        self._client = {k: v for k, v in client.items() if v is not None}
        self._models: tuple[CompanyConfig, float, list[MediaModel]] | None = None

    @classmethod
    def from_settings(cls, settings: Settings, **kwargs: Any) -> "CompanyMedia":
        """The server ``settings`` point at, followed live while ``company.json`` decides."""
        return cls(lambda: configured(settings), **kwargs)

    # ---- plumbing -----------------------------------------------------------------------------

    def _server(self) -> tuple[CompanyConfig, str, str]:
        """(config, the media service's root URL, the key), or MediaError."""
        found = self._config()
        if found is None:
            raise self._failed("media_unavailable", 503)
        try:
            key = self._secret()
        except Exception as exc:  # the key store cannot be used on this machine
            log_event(log, "media_key_unreadable", error_code=type(exc).__name__)
            key = None
        key = key.strip() if key else None
        if not key or not valid_key(key):
            raise self._failed("company_key_missing", 503)
        parts = urlsplit(found.base_url)
        return found, f"{parts.scheme}://{parts.netloc}{PATH}", key

    def _failed(self, code: str, status: int) -> MediaError:
        log_event(log, "media_failed", error_code=code)
        return MediaError(code, status)

    @contextmanager
    def _call(self, found: CompanyConfig) -> Iterator[Any]:
        """An HTTP client to the configured host only; transport failures become MediaError."""
        try:
            with net.outbound_client(
                net.Allowlist(company=lambda: found.base_url),
                timeout=net.Timeout(TIMEOUT_S, connect=CONNECT_S),
                **self._client,
            ) as client:
                yield client
        except MediaError:
            raise
        except (net.HostNotAllowed, net.HTTPError) as exc:
            raise self._failed("media_unreachable", 503) from exc

    def _check(self, resp: Any, missing: str) -> None:
        """Turn the server's refusal into a short code. ``missing``: the code for a 404."""
        status = resp.status_code
        if status < 400:
            return
        if status in (401, 403):
            raise self._failed("company_key_rejected", 502)
        if status == 404:
            raise self._failed(missing, 404 if missing == "media_job_not_found" else 503)
        if status == 429:
            raise self._failed("media_busy", 429)
        if status in (400, 413, 422):
            try:
                error = resp.json().get("error")
            except (ValueError, AttributeError):
                error = None
            code = error.get("code") if isinstance(error, dict) else None
            raise self._failed(safe_code(code, "media_refused"), 400)
        raise self._failed("media_unreachable", 503)

    def _headers(self, key: str) -> dict[str, str]:
        return {**HEADERS, "Authorization": f"Bearer {key}"}

    # ---- MediaSource --------------------------------------------------------------------------

    def media_models(self) -> list[MediaModel]:
        """What the server can make now. Remembered briefly, per server."""
        found, root, key = self._server()
        if self._models and self._models[0] == found:
            if self._clock() - self._models[1] < MODELS_TTL_S:
                return list(self._models[2])
        with self._call(found) as client:
            resp = client.get(f"{root}/models", headers=self._headers(key))
            self._check(resp, "media_not_offered")
            try:
                listed = resp.json().get("data", [])
            except (ValueError, AttributeError) as exc:
                raise self._failed("media_bad_answer", 502) from exc
        models = [
            MediaModel(id=m["id"], kind=m["kind"])
            for m in listed
            if isinstance(m, dict)
            and isinstance(m.get("id"), str)
            and MODEL_ID.fullmatch(m["id"])
            and m.get("kind") in KINDS
        ]
        self._models = (found, self._clock(), models)
        return list(models)

    def media_submit(self, job: MediaJob) -> RemoteJob:
        check_job(job)
        found, root, key = self._server()
        with self._call(found) as client:
            resp = client.post(f"{root}/jobs", json=job.body(), headers=self._headers(key))
            self._check(resp, "media_not_offered")
            remote = self._job(resp)
        log_event(log, "media_submitted", kind=job.kind, model=job.model)
        return remote

    def media_job(self, job_id: str) -> RemoteJob:
        found, root, key = self._server()
        with self._call(found) as client:
            resp = client.get(f"{root}/jobs/{check_job_id(job_id)}", headers=self._headers(key))
            self._check(resp, "media_job_not_found")
            return self._job(resp)

    def media_output(self, job_id: str, index: int) -> tuple[bytes, str]:
        if type(index) is not int or not 0 <= index < 16:
            raise MediaError("media_job_not_found", 404)
        found, root, key = self._server()
        url = f"{root}/jobs/{check_job_id(job_id)}/outputs/{index}"
        with (
            self._call(found) as client,
            client.stream("GET", url, headers=self._headers(key)) as resp,
        ):
            self._check(resp, "media_job_not_found")
            mime = resp.headers.get("content-type", "").split(";")[0].strip().lower()
            if mime not in MIMES:
                raise self._failed("media_bad_answer", 502)
            data = bytearray()
            for chunk in resp.iter_bytes():
                data += chunk
                if len(data) > MAX_OUTPUT_BYTES:
                    raise self._failed("media_output_too_large", 502)
        return bytes(data), mime

    def media_cancel(self, job_id: str) -> None:
        found, root, key = self._server()
        with self._call(found) as client:
            resp = client.delete(f"{root}/jobs/{check_job_id(job_id)}", headers=self._headers(key))
            self._check(resp, "media_job_not_found")

    def _job(self, resp: Any) -> RemoteJob:
        try:
            data = resp.json()
        except ValueError as exc:
            raise self._failed("media_bad_answer", 502) from exc
        return RemoteJob.from_json(data)
