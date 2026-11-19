"""Long conversations stay within the model's context (M-07, MVP 11.2): summaries of the earlier
messages.

Each request is rebuilt from the conversation: the latest summary, then the newest messages that
fit. After an answer, once the history after the summary takes more than half the budget, the
earlier part is summarised in the background by the same model (through the provider router and
the gateway, like any answer), stored in ``summaries`` and recorded as a content-free inference
event.
"""

import json
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from tests.conftest import LAUNCH_TOKEN, LOOPBACK, FakeAnswers

from aios_backend.apps.chat.service import SUMMARY_INSTRUCTION, context_budget, estimate_tokens
from aios_backend.config import Settings
from aios_backend.main import create_app
from db.session import Database

CONTEXT = 2400  # history budget: 2400 - answer reserve - system prompt = 680 tokens
LONG = "Here are the meeting notes for the budget review. " * 14  # about 200 tokens


@pytest.fixture
def small_model() -> FakeAnswers:
    return FakeAnswers("Noted.", context_length=CONTEXT)


@pytest.fixture
def api(settings: Settings, db: Database, small_model: FakeAnswers) -> Iterator[TestClient]:
    headers = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}
    with TestClient(create_app(settings, db, small_model), client=LOOPBACK, headers=headers) as c:
        yield c


def conversation(api: TestClient) -> str:
    project = api.post("/projects", json={"name": "P", "classification": "internal"}).json()
    return api.post(f"/projects/{project['id']}/conversations", json={}).json()["id"]


def send(api: TestClient, conv: str, text: str) -> dict:
    """Send, then wait for the summary refresh that runs in the background after the answer."""
    resp = api.post(f"/conversations/{conv}/messages", json={"text": text})
    assert resp.status_code == 200, resp.text
    api.app.state.generations.background.wait(10)  # type: ignore[attr-defined]
    return resp.json()


def answer_calls(model: FakeAnswers) -> list[list[dict[str, str]]]:
    return [c["messages"] for c in model.calls if not _is_summary_call(c["messages"])]


def _is_summary_call(messages: list[dict[str, str]]) -> bool:
    """The request that writes a summary (not an answer that starts with one)."""
    return messages[0] == {"role": "system", "content": SUMMARY_INSTRUCTION}


def test_a_short_conversation_is_sent_whole_and_not_summarised(
    api: TestClient, small_model: FakeAnswers
) -> None:
    conv = conversation(api)
    send(api, conv, "Short question one")
    send(api, conv, "Short question two")
    last = answer_calls(small_model)[-1]
    assert [m["content"] for m in last] == ["Short question one", "Noted.", "Short question two"]
    assert api.get(f"/conversations/{conv}/summary").json() is None


def test_m07_a_long_conversation_is_summarised_and_stays_within_budget(
    api: TestClient, small_model: FakeAnswers
) -> None:
    conv = conversation(api)
    for _ in range(6):
        send(api, conv, LONG)

    summary = api.get(f"/conversations/{conv}/summary").json()
    assert summary is not None and summary["content"] == "Noted."
    messages = api.get(f"/conversations/{conv}/messages").json()
    assert summary["covers_until_message_id"] in {m["id"] for m in messages}

    # The last request: the summary first, then only the newest messages, within the budget.
    last = answer_calls(small_model)[-1]
    assert last[0]["role"] == "system" and "Noted." in last[0]["content"]
    budget = context_budget(CONTEXT)
    assert sum(estimate_tokens(m["content"]) for m in last) <= budget
    assert last[-1]["content"] == LONG.strip()  # the question just asked is always there


def test_the_summary_request_sees_only_what_fits(api: TestClient, small_model: FakeAnswers) -> None:
    conv = conversation(api)
    for _ in range(6):
        send(api, conv, LONG)
    summary_calls = [c["messages"] for c in small_model.calls if _is_summary_call(c["messages"])]
    assert summary_calls
    for call in summary_calls:
        assert sum(estimate_tokens(m["content"]) for m in call) <= context_budget(CONTEXT)


def test_m07_the_summary_is_recorded_without_its_text(
    api: TestClient, small_model: FakeAnswers
) -> None:
    conv = conversation(api)
    for _ in range(6):
        send(api, conv, LONG)
    events = api.get("/evidence").json()
    summarised = [e for e in events if e["payload"].get("purpose") == "summary"]
    assert summarised and summarised[-1]["event_type"] == "inference_completed"
    assert summarised[-1]["conversation_id"] == conv
    raw = json.dumps(summarised)
    assert "budget review" not in raw and "Noted." not in raw  # commitments only (SR-07)
