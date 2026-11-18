"""G-05 / AC-07: summaries are refreshed in the background after an answer (MVP 11.2), are capped
in length, and a 100-message conversation keeps coherent context within the model's budget."""

import threading
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from tests.conftest import LAUNCH_TOKEN, LOOPBACK, FakeAnswers

from aios_backend.apps.chat.service import (
    SUMMARY_INSTRUCTION,
    SUMMARY_MAX_TOKENS,
    context_budget,
    safe_estimate,
)
from aios_backend.config import Settings
from aios_backend.main import create_app
from db.session import Database

CONTEXT = 2400  # budget 680 tokens
FACT = "The project code word is BLUE-HERON."


class SummarisingModel(FakeAnswers):
    """Answers "Noted."; a summary request gets ``summary`` (carrying the first message's fact).
    ``hold`` keeps a summary request waiting until it is set."""

    def __init__(self, summary: str = f"{FACT} The person sent supplier questions.") -> None:
        super().__init__("Noted.", context_length=CONTEXT)
        self.summary = summary
        self.hold: threading.Event | None = None

    def answer(self, provider: str, model_id: str, messages: list[dict[str, str]]) -> Iterator[str]:
        if messages[0]["content"] != SUMMARY_INSTRUCTION:
            yield from super().answer(provider, model_id, messages)
            return
        self.calls.append({"provider": provider, "model_id": model_id, "messages": messages})
        if self.hold is not None:
            assert self.hold.wait(10)
        for word in self.summary.split(" "):
            yield word + " "


def is_summary(call: dict[str, Any]) -> bool:
    return bool(call["messages"][0]["content"] == SUMMARY_INSTRUCTION)


@pytest.fixture
def model() -> SummarisingModel:
    return SummarisingModel()


@pytest.fixture
def api(settings: Settings, db: Database, model: SummarisingModel) -> Iterator[TestClient]:
    headers = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}
    with TestClient(create_app(settings, db, model), client=LOOPBACK, headers=headers) as c:
        yield c
        c.app.state.generations.background.wait(10)  # type: ignore[attr-defined]


def conversation(api: TestClient) -> str:
    project = api.post("/projects", json={"name": "P", "classification": "internal"}).json()
    return str(api.post(f"/projects/{project['id']}/conversations", json={}).json()["id"])


def send(api: TestClient, conv: str, text: str, wait: bool = True) -> None:
    resp = api.post(f"/conversations/{conv}/messages", json={"text": text})
    assert resp.status_code == 200, resp.text
    if wait:
        api.app.state.generations.background.wait(10)  # type: ignore[attr-defined]


QUESTION = "Which supplier sent the March delivery note, and is the invoice matched yet? " * 3


def test_ac_07_a_100_message_conversation_keeps_coherent_context(
    api: TestClient, model: SummarisingModel
) -> None:
    conv = conversation(api)
    send(api, conv, f"{FACT} {QUESTION}")
    for _ in range(49):  # 50 questions and 50 answers: 100 messages
        send(api, conv, QUESTION)
    assert len(api.get(f"/conversations/{conv}/messages").json()) == 100

    answers = [c["messages"] for c in model.calls if not is_summary(c)]
    summaries = [c for c in model.calls if is_summary(c)]
    assert len(answers) == 50
    assert 0 < len(summaries) < 25  # refreshed now and then, not after every answer
    budget = context_budget(CONTEXT)
    for request in answers:
        assert sum(safe_estimate(m["content"]) for m in request) <= budget  # within the budget
        assert request[-1]["content"].strip() == QUESTION.strip() or FACT in request[-1]["content"]
        assert "<think>" not in str(request)  # reasoning text is never re-sent
        # Coherent: the first message's fact is always there, itself or through the summary.
        assert any(FACT in m["content"] for m in request)
    assert api.get(f"/conversations/{conv}/summary").json()["content"].startswith(FACT)


def test_g05_the_answer_does_not_wait_for_the_summary(
    api: TestClient, model: SummarisingModel
) -> None:
    conv = conversation(api)
    for _ in range(4):
        send(api, conv, QUESTION)
    model.hold = threading.Event()  # the next summary request hangs until released
    try:
        for _ in range(4):
            send(api, conv, QUESTION, wait=False)  # answered while the summary is still running
        assert sum(1 for c in model.calls if is_summary(c)) >= 1
    finally:
        model.hold.set()
    api.app.state.generations.background.wait(10)  # type: ignore[attr-defined]


def test_g05_a_long_summary_is_cut_at_the_cap(api: TestClient, model: SummarisingModel) -> None:
    model.summary = "The supplier list was checked and the invoices were matched. " * 200
    conv = conversation(api)
    for _ in range(8):  # past three quarters of the budget
        send(api, conv, QUESTION)
    summary = api.get(f"/conversations/{conv}/summary").json()
    assert summary is not None
    assert len(summary["content"]) <= SUMMARY_MAX_TOKENS * 3.5
    assert summary["content"].endswith(".")  # ends at a full sentence
