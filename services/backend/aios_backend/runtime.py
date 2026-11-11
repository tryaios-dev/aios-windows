"""In-process state shared by several apps: the answer being generated right now.

Not stored anywhere. Chat registers a generation while it produces an answer; Stop asks it to
end; the models app (benchmark) and the system status read whether one is running. Only one
generation runs at a time, like the UI expects (a second send answers ``409 busy``).
"""

import threading
from dataclasses import dataclass, field
from typing import Annotated, Any

from fastapi import Depends, Request

STOP_WAIT_SECONDS = 10.0


@dataclass
class Generation:
    conversation_id: str
    message_id: str
    provider: str
    phase: str = "preparing"  # loading_engine | preparing | streaming
    cancel: threading.Event = field(default_factory=threading.Event)
    finished: threading.Event = field(default_factory=threading.Event)
    result: Any = None  # the final message, set by chat when the answer is stored


class Busy(Exception):
    """Another answer is being generated."""


class Generations:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._current: Generation | None = None

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
