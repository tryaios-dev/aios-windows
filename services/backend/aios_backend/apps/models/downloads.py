"""Model downloads in progress: one worker thread per download, state kept in memory.

A download writes ``<file_name>.download`` in the models folder and resumes from its size. When
every byte has arrived, ``install`` (given by the service) checks size and SHA-256 against the
catalogue and installs the file, exactly like an offline import. No database access here: each
change of status is passed to ``Job.report`` (given by the service), which saves it in
``model_downloads`` so a download is still listed after a restart.
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
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._jobs: dict[str, Job] = {}
        self.loaded = False  # jobs saved before this start have been taken back

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
            target=_work, args=(job, mirror, install), name="aios-download", daemon=True
        )
        job.thread.start()


def _work(job: Job, mirror: ModelMirror, install: Callable[[Path], None]) -> None:
    job.part.parent.mkdir(parents=True, exist_ok=True)
    offset = job.part.stat().st_size if job.part.exists() else 0
    job.received_bytes = offset
    job.status = "downloading"
    job.tell()
    began, fetched = time.monotonic(), 0
    try:
        with open(job.part, "ab") as out:
            for chunk in mirror.fetch(job.entry_id, job.url, offset):
                if job.cancel.is_set():
                    return
                if job.pause.is_set():
                    job.status, job.speed_bps = "paused", 0
                    job.tell()
                    return
                out.write(chunk)
                fetched += len(chunk)
                job.received_bytes += len(chunk)
                job.speed_bps = int(fetched / max(time.monotonic() - began, 1e-3))
                if job.received_bytes > job.total_bytes:
                    raise AppError("size_mismatch", 422)
        if job.cancel.is_set():
            return
        if job.pause.is_set() and job.received_bytes < job.total_bytes:
            job.status, job.speed_bps = "paused", 0
            job.tell()
            return
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


def get_downloads(request: Request) -> Downloads:
    downloads: Downloads = request.app.state.downloads
    return downloads


DownloadsDep = Annotated[Downloads, Depends(get_downloads)]
