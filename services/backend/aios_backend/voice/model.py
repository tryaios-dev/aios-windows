"""Download the speech model (ADR 0016): started in setup, next to the AI model, or from
Settings > Voice.

One pinned file from Hugging Face, through the network door (aios_backend.net: allowlisted
hosts on every hop, OS certificates). It is written to ``<file>.download`` in the models folder
and resumed from its size; a dropped connection is retried until no byte has arrived for a
while (as model downloads, D-07). Only a file with the pinned size and SHA-256 is moved into
place; anything else is deleted. The state lives in memory: after a restart the partial file is
resumed by the next start.
"""

import hashlib
import threading
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from pathlib import Path

from aios_backend import net
from aios_common.logging import get_logger, log_event

# Whisper small, multilingual, q5_1 (MIT), at a pinned revision of ggerganov/whisper.cpp.
URL = (
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/"
    "5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small-q5_1.bin"
)
SIZE = 190_085_487
CHUNK = 1024 * 1024
RETRY_DELAYS = (2.0, 5.0, 10.0, 20.0, 30.0)  # the last one repeats
GIVE_UP_AFTER_S = 600.0

log = get_logger("voice")

Fetch = Callable[[str, int], Iterator[bytes]]


@dataclass
class ModelDownload:
    """What the setup line and Settings > Voice show."""

    status: str = "idle"  # idle | downloading | verifying | failed | done
    received_bytes: int = 0
    total_bytes: int = SIZE
    error: str | None = None
    thread: threading.Thread | None = field(default=None, repr=False)
    cancel: threading.Event = field(default_factory=threading.Event, repr=False)


def fetch(url: str, offset: int) -> Iterator[bytes]:
    """The file from byte ``offset`` on, through the network door."""
    headers = {"User-Agent": "AIOS"}  # no user, machine or account details
    if offset:
        headers["Range"] = f"bytes={offset}-"
    with (
        net.outbound_client(net.Allowlist(), timeout=net.Timeout(30.0, read=60.0)) as client,
        client.stream("GET", url, headers=headers) as resp,
    ):
        if resp.status_code != (206 if offset else 200):
            raise OSError(f"status_{resp.status_code}")
        yield from resp.iter_bytes(CHUNK)


class ModelDownloader:
    def __init__(
        self,
        target: Path,
        sha256: str,
        *,
        url: str = URL,
        size: int = SIZE,
        fetch_fn: Fetch = fetch,
        retry_delays: tuple[float, ...] = RETRY_DELAYS,
        give_up_after_s: float = GIVE_UP_AFTER_S,
        on_done: Callable[[], None] = lambda: None,
    ) -> None:
        self._target = target
        self._sha256 = sha256
        self._url = url
        self._size = size
        self._fetch = fetch_fn
        self._delays = retry_delays
        self._give_up = give_up_after_s
        self._on_done = on_done
        self._lock = threading.Lock()
        self.state = ModelDownload(total_bytes=size)

    @property
    def part(self) -> Path:
        return self._target.with_name(self._target.name + ".download")

    def start(self) -> ModelDownload:
        """Start, or carry on after a failure. Does nothing while one is running."""
        with self._lock:
            running = self.state.thread is not None and self.state.thread.is_alive()
            if running:
                return self.state
            self.state = ModelDownload(status="downloading", total_bytes=self._size)
            self.state.thread = threading.Thread(
                target=self._work, args=(self.state,), name="aios-voice-model", daemon=True
            )
            self.state.thread.start()
            return self.state

    def stop(self, timeout: float = 10.0) -> None:
        state = self.state
        state.cancel.set()
        if state.thread is not None:
            state.thread.join(timeout)

    # ---- worker ---------------------------------------------------------------------------

    def _work(self, state: ModelDownload) -> None:
        began = time.monotonic()
        self.part.parent.mkdir(parents=True, exist_ok=True)
        try:
            if not self._fetch_all(state):
                state.status = "idle"
                return
            state.status = "verifying"
            if self.part.stat().st_size != self._size or _sha256(self.part) != self._sha256:
                self.part.unlink(missing_ok=True)
                raise _Failed("digest_mismatch")
            self.part.replace(self._target)
            state.status = "done"
            log_event(
                log, "voice_model_downloaded", duration_ms=round((time.monotonic() - began) * 1000)
            )
            self._on_done()
        except _Failed as exc:
            state.status, state.error = "failed", exc.code
            log_event(log, "voice_model_download_failed", error_code=exc.code)
        except Exception as exc:
            state.status, state.error = "failed", "unreachable"
            log_event(log, "voice_model_download_failed", error_code=type(exc).__name__)

    def _fetch_all(self, state: ModelDownload) -> bool:
        """Fetch until every byte is there; False if stopped. Network errors are retried until
        no byte has arrived for ``give_up_after_s``."""
        attempt, last_progress = 0, time.monotonic()
        while True:
            state.received_bytes = self.part.stat().st_size if self.part.exists() else 0
            if state.received_bytes >= self._size:
                return True
            before = state.received_bytes
            try:
                with self.part.open("ab") as out:
                    for chunk in self._fetch(self._url, state.received_bytes):
                        if state.cancel.is_set():
                            return False
                        out.write(chunk)
                        state.received_bytes += len(chunk)
                        if state.received_bytes > self._size:
                            out.close()
                            self.part.unlink(missing_ok=True)
                            raise _Failed("size_mismatch")
            except _Failed:
                raise
            except Exception:
                if state.received_bytes > before:
                    attempt, last_progress = 0, time.monotonic()
                if time.monotonic() - last_progress >= self._give_up:
                    raise
                deadline = time.monotonic() + self._delays[min(attempt, len(self._delays) - 1)]
                while time.monotonic() < deadline:
                    if state.cancel.is_set():
                        return False
                    time.sleep(0.05)
                attempt += 1


class _Failed(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(CHUNK), b""):
            h.update(chunk)
    return h.hexdigest()
