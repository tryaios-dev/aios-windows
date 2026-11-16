"""Model downloads in progress: one worker thread per download, state kept in memory.

A download writes ``<file_name>.download`` in the models folder and resumes from its size. When
every byte has arrived, ``install`` (given by the service) checks size and SHA-256 against the
catalogue and installs the file, exactly like an offline import. No database access here: each
change of status is passed to ``Job.report`` (given by the service), which saves it in
``model_downloads`` so a download is still listed after a restart.

A dropped connection (a pulled cable, Wi-Fi gone, the mirror timing out) does not fail the
download: the worker waits and asks again from the partial file's size, and only gives up after
``RetryPolicy.give_up_after`` seconds without a single new byte (D-07). A wrong file (size or
digest) is never retried. The user can still pause or cancel while it waits.
"""

import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Annotated

from fastapi import Depends, Request

from aios_backend.apps.models.mirror import ModelMirror
from aios_backend.errors import AppError
from db.base import utcnow

JOIN_SECONDS = 10.0
ACTIVE = ("queued", "downloading", "verifying")
POLL_SECONDS = 0.05  # how often a waiting worker looks at pause and cancel


@dataclass(frozen=True)
class RetryPolicy:
    """How a download behaves when the connection drops. The download manager (I-03) owns the
    final values; these keep a pulled cable from failing a multi-gigabyte download."""

    delays: tuple[float, ...] = (2.0, 5.0, 10.0, 20.0, 30.0)  # seconds; the last one repeats
    give_up_after: float = 600.0  # seconds without receiving a byte

    def delay(self, attempt: int) -> float:
        return self.delays[min(attempt, len(self.delays) - 1)]


@dataclass
class Job:
    entry_id: str
    url: str
    part: Path
    total_bytes: int
    status: str = "queued"  # queued | downloading | paused | verifying | failed | done
    received_bytes: int = 0
    speed_bps: int = 0
    error: str | None = None
    started_at: datetime = field(default_factory=utcnow)
    pause: threading.Event = field(default_factory=threading.Event)
    cancel: threading.Event = field(default_factory=threading.Event)
    thread: threading.Thread | None = None
    report: Callable[["Job"], None] | None = None  # called on every change of status

    def tell(self) -> None:
        if self.report is not None:
            try:
                self.report(self)
            except Exception:  # noqa: S110 - saving the state must never stop the download
                pass


class Downloads:
    def __init__(self, retry: RetryPolicy | None = None) -> None:
        self._lock = threading.Lock()
        self._jobs: dict[str, Job] = {}
        self.loaded = False  # jobs saved before this start have been taken back
        self.retry = retry or RetryPolicy()

    def get(self, entry_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(entry_id)

    def adopt(self, job: Job) -> None:
        """A job saved before a restart: listed, not running."""
        with self._lock:
            self._jobs.setdefault(job.entry_id, job)

    def all(self) -> list[Job]:
        with self._lock:
            return list(self._jobs.values())

    def start(
        self,
        job: Job,
        mirror: ModelMirror,
        install: Callable[[Path], None],
    ) -> Job:
        with self._lock:
            current = self._jobs.get(job.entry_id)
            if current is not None and current.status in (*ACTIVE, "paused"):
                raise AppError("download_exists", 409)
            self._jobs[job.entry_id] = job
        self._run(job, mirror, install)
        return job

    def resume(self, job: Job, mirror: ModelMirror, install: Callable[[Path], None]) -> Job:
        if job.status in ACTIVE:
            return job
        job.pause.clear()
        job.error = None
        job.status = "queued"
        self._run(job, mirror, install)
        return job

    def pause(self, job: Job) -> Job:
        if job.status not in ("queued", "downloading"):
            raise AppError("not_downloading", 409)
        job.pause.set()
        if job.thread is not None:
            job.thread.join(JOIN_SECONDS)
        return job

    def cancel(self, job: Job) -> None:
        job.cancel.set()
        if job.thread is not None:
            job.thread.join(JOIN_SECONDS)
        job.part.unlink(missing_ok=True)
        with self._lock:
            if self._jobs.get(job.entry_id) is job:
                del self._jobs[job.entry_id]

    def _run(self, job: Job, mirror: ModelMirror, install: Callable[[Path], None]) -> None:
        job.thread = threading.Thread(
            target=_work,
            args=(job, mirror, install, self.retry),
            name="aios-download",
            daemon=True,
        )
        job.thread.start()


def _work(
    job: Job, mirror: ModelMirror, install: Callable[[Path], None], retry: RetryPolicy
) -> None:
    job.part.parent.mkdir(parents=True, exist_ok=True)
    job.received_bytes = job.part.stat().st_size if job.part.exists() else 0
    job.status = "downloading"
    job.tell()
    try:
        if not _fetch_all(job, mirror, retry):
            return  # paused or cancelled
        if job.received_bytes != job.total_bytes:
            raise AppError("download_incomplete", 502)
        job.status, job.speed_bps = "verifying", 0
        job.tell()
        install(job.part)
        job.status = "done"
        job.tell()
    except AppError as exc:
        job.status, job.error, job.speed_bps = "failed", exc.code, 0
        if exc.code in ("size_mismatch", "digest_mismatch"):
            job.part.unlink(missing_ok=True)  # resuming a wrong file would never succeed
        job.tell()
    except Exception:
        job.status, job.error, job.speed_bps = "failed", "mirror_unreachable", 0
        job.tell()


def _fetch_all(job: Job, mirror: ModelMirror, retry: RetryPolicy) -> bool:
    """Fetch until every byte is there. False if paused or cancelled on the way. A network
    error is retried until ``retry.give_up_after`` seconds pass without progress; then the
    last error is raised."""
    if job.received_bytes >= job.total_bytes:
        return True  # complete already (stopped while verifying): check it, do not ask for more
    attempt = 0
    last_progress = time.monotonic()
    while True:
        before = job.received_bytes
        try:
            return _fetch_once(job, mirror)
        except AppError:
            raise
        except Exception:
            if job.received_bytes > before:
                attempt, last_progress = 0, time.monotonic()
            if time.monotonic() - last_progress >= retry.give_up_after:
                raise
            job.speed_bps = 0
            if not _wait(job, retry.delay(attempt)):
                return False
            attempt += 1


def _fetch_once(job: Job, mirror: ModelMirror) -> bool:
    """One request from the partial file's size to the end. False if paused or cancelled."""
    began, fetched = time.monotonic(), 0
    with open(job.part, "ab") as out:
        for chunk in mirror.fetch(job.entry_id, job.url, job.received_bytes):
            if _stopping(job):
                return False
            out.write(chunk)
            out.flush()
            fetched += len(chunk)
            job.received_bytes += len(chunk)
            job.speed_bps = int(fetched / max(time.monotonic() - began, 1e-3))
            if job.received_bytes > job.total_bytes:
                raise AppError("size_mismatch", 422)
    if job.cancel.is_set():
        return False
    if job.pause.is_set() and job.received_bytes < job.total_bytes:
        _paused(job)
        return False
    return True


def _wait(job: Job, seconds: float) -> bool:
    """Sleep before the next attempt, but stop at once on pause or cancel. False if stopped."""
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if _stopping(job):
            return False
        time.sleep(min(POLL_SECONDS, max(deadline - time.monotonic(), 0)))
    return not _stopping(job)


def _stopping(job: Job) -> bool:
    if job.cancel.is_set():
        return True
    if job.pause.is_set():
        _paused(job)
        return True
    return False


def _paused(job: Job) -> None:
    job.status, job.speed_bps = "paused", 0
    job.tell()


def get_downloads(request: Request) -> Downloads:
    downloads: Downloads = request.app.state.downloads
    return downloads


DownloadsDep = Annotated[Downloads, Depends(get_downloads)]
