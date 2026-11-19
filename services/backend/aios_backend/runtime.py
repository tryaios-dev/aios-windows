"""In-process state shared by several apps: the answer being generated right now.

Not stored anywhere. Chat registers a generation while it produces an answer; Stop asks it to
end; the models app (benchmark) and the system status read whether one is running. Only one
generation runs at a time, like the UI expects (a second send answers ``409 busy``).
``Generations.background`` runs the work chat does after an answer: refreshing a conversation's
summary (MVP 11.2), so the next request does not wait for it.
"""

import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Annotated, Any

from fastapi import Depends, Request

from aios_common.logging import get_logger, log_event

log = get_logger("runtime")

STOP_WAIT_SECONDS = 10.0


@dataclass
class Generation:
    conversation_id: str
    message_id: str
    provider: str
    phase: str = "preparing"  # loading_engine | preparing | streaming
    # The answer so far, for the desktop app's live view (GET .../generation). Memory only:
    # never stored or logged here; the finished answer is stored by chat as usual.
    text: str = ""
    cancel: threading.Event = field(default_factory=threading.Event)
    finished: threading.Event = field(default_factory=threading.Event)
    result: Any = None  # the final message, set by chat when the answer is stored


class Busy(Exception):
    """Another answer is being generated."""


class Background:
    """Work after an answer, in its own thread: at most one job per conversation at a time."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._running: dict[str, threading.Thread] = {}

    def start(self, conversation_id: str, work: Callable[[], None]) -> bool:
        """Run ``work`` unless a job for this conversation is still running. True if started."""
        with self._lock:
            running = self._running.get(conversation_id)
            if running is not None and running.is_alive():
                return False
            thread = threading.Thread(
                target=self._run, args=(conversation_id, work), name="aios-summary", daemon=True
            )
            self._running[conversation_id] = thread
        thread.start()
        return True

    def _run(self, conversation_id: str, work: Callable[[], None]) -> None:
        try:
            work()
        except Exception as exc:  # the next answer tries again
            log_event(log, "background_job_failed", error_code=type(exc).__name__)
        finally:
            with self._lock:
                if self._running.get(conversation_id) is threading.current_thread():
                    del self._running[conversation_id]

    def wait(self, timeout: float | None = None) -> None:
        """Until the jobs running now have ended (tests; shutdown)."""
        with self._lock:
            threads = list(self._running.values())
        for thread in threads:
            thread.join(timeout)


class Generations:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._current: Generation | None = None
        self.background = Background()

    def begin(self, conversation_id: str, message_id: str, provider: str) -> Generation:
        with self._lock:
            if self._current is not None:
                raise Busy
            self._current = Generation(conversation_id, message_id, provider)
            return self._current

    def end(self, generation: Generation, result: Any = None) -> None:
        with self._lock:
            generation.result = result
            if self._current is generation:
                self._current = None
        generation.finished.set()

    def current(self) -> Generation | None:
        with self._lock:
            return self._current

    def for_conversation(self, conversation_id: str) -> Generation | None:
        current = self.current()
        return current if current and current.conversation_id == conversation_id else None

    def busy(self) -> bool:
        return self.current() is not None


def get_generations(request: Request) -> Generations:
    generations: Generations = request.app.state.generations
    return generations


GenerationsDep = Annotated[Generations, Depends(get_generations)]
