"""The seam between chat and whatever produces answers (MVP: providers -> gateway -> engine).

Chat never talks to a model itself. ``create_app`` puts an ``AnswerSource`` on
``app.state.answers``; today that is ``None`` (the local model module is not built yet), so
sending a message answers ``409 no_model`` and nothing is stored. Tests plug in a fake.
"""

from collections.abc import Iterator
from dataclasses import dataclass
from typing import Annotated, Protocol

from fastapi import Depends, Request


@dataclass(frozen=True)
class ModelInfo:
    model_id: str
    context_length: int  # tokens
    runtime: str  # e.g. "llama-server b6471 vulkan"; recorded in evidence


class AnswerSource(Protocol):
    def model(self, provider: str, model_id: str | None) -> ModelInfo | None:
        """The model that would answer, or None if it is not installed / not reachable."""
        ...

    def answer(self, provider: str, model_id: str, messages: list[dict[str, str]]) -> Iterator[str]:
        """Answer text in chunks. Raising mid-way leaves a partial answer."""
        ...


def get_answers(request: Request) -> AnswerSource | None:
    source: AnswerSource | None = getattr(request.app.state, "answers", None)
    return source


Answers = Annotated[AnswerSource | None, Depends(get_answers)]
