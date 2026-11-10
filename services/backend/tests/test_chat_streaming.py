"""Chat additions: one conversation, streamed answers, Stop, generation state, continue locally."""

import dataclasses
import json
import threading
import time
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from tests.conftest import LAUNCH_TOKEN, LOOPBACK, FakeAnswers

from aios_backend.config import Settings
from aios_backend.main import create_app
from db.session import Database


def setup_conversation(client: TestClient) -> tuple[dict, dict]:
    project = client.post("/projects", json={"name": "P", "classification": "internal"}).json()
    conv = client.post(f"/projects/{project['id']}/conversations", json={}).json()
    return project, conv


def frames(body: str) -> list[tuple[str, dict[str, Any]]]:
    """Parse a Server-Sent Events body into (event, data) pairs."""
    out = []
    for block in body.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        out.append((lines["event"], json.loads(lines["data"])))
    return out


class SlowAnswers(FakeAnswers):
    """Many words with a pause between them, so Stop can arrive mid-answer."""

    def __init__(self) -> None:
        super().__init__(" ".join(f"w{i}" for i in range(200)))

    def answer(self, provider: str, model_id: str, messages: list[dict[str, str]]) -> Iterator[str]:
        for chunk in super().answer(provider, model_id, messages):
            time.sleep(0.02)
            yield chunk


def client_with(settings: Settings, db: Database, answers: FakeAnswers) -> TestClient:
    headers = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}
    return TestClient(create_app(settings, db, answers), client=LOOPBACK, headers=headers)


# ------------------------------------------------------------------ one conversation
def test_get_one_conversation(client: TestClient) -> None:
    _, conv = setup_conversation(client)
    assert client.get(f"/conversations/{conv['id']}").json() == conv
    missing = client.get("/conversations/nope")
    assert missing.status_code == 404 and missing.json() == {"error": "conversation_not_found"}


# ------------------------------------------------------------------ streaming
def test_stream_send_emits_started_phases_deltas_and_done(chat: TestClient) -> None:
    _, conv = setup_conversation(chat)
    resp = chat.post(f"/conversations/{conv['id']}/messages/stream", json={"text": "Hello"})
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    events = frames(resp.text)
    names = [name for name, _ in events]
    assert names[:3] == ["started", "phase", "phase"]
    assert events[1][1] == {"phase": "preparing"} and events[2][1] == {"phase": "streaming"}
    assert names[-1] == "done"
    text = "".join(data["text"] for name, data in events if name == "delta")
    assert text == "A local answer."
    done = events[-1][1]["assistant"]
    assert done["content"] == text and done["status"] == "complete"
    assert events[0][1]["user"]["content"] == "Hello"
    assert events[0][1]["assistant_id"] == done["id"]

    stored = chat.get(f"/conversations/{conv['id']}/messages").json()
    assert [m["content"] for m in stored] == ["Hello", "A local answer."]
    assert chat.get("/evidence").json()[-1]["event_type"] == "inference_completed"


def test_stream_errors_before_the_stream_are_http_errors(client: TestClient) -> None:
    _, conv = setup_conversation(client)
    resp = client.post(f"/conversations/{conv['id']}/messages/stream", json={"text": "hi"})
    assert resp.status_code == 409 and resp.json() == {"error": "no_model"}
    assert client.get(f"/conversations/{conv['id']}/messages").json() == []


def test_stream_interrupted_answer_is_kept_as_partial(
    chat: TestClient, answers: FakeAnswers
) -> None:
    _, conv = setup_conversation(chat)
    answers.fail_after = 2
    events = frames(
        chat.post(f"/conversations/{conv['id']}/messages/stream", json={"text": "x"}).text
    )
    name, data = events[-1]
    assert name == "error" and data["error"] == "answer_interrupted"
    assert data["assistant"]["status"] == "partial" and data["assistant"]["content"] == "A local"


def test_stream_regenerate_keeps_the_previous_version(chat: TestClient) -> None:
    _, conv = setup_conversation(chat)
    chat.post(f"/conversations/{conv['id']}/messages", json={"text": "q"})
    events = frames(chat.post(f"/conversations/{conv['id']}/regenerate/stream").text)
    assert events[0] == (
        "started",
        {"user": None, "assistant_id": events[-1][1]["assistant"]["id"]},
    )
    assert events[-1][1]["assistant"]["previous_versions"] == ["A local answer."]


# ------------------------------------------------------------------ stop and generation state
def test_stop_without_a_generation(client: TestClient) -> None:
    _, conv = setup_conversation(client)
    resp = client.post(f"/conversations/{conv['id']}/stop")
    assert resp.status_code == 409 and resp.json() == {"error": "not_generating"}
    state = client.get(f"/conversations/{conv['id']}/generation").json()
    assert state == {"generating": False, "message_id": None, "phase": None, "provider": None}


@pytest.mark.parametrize("path", ["messages", "messages/stream"])
def test_stop_keeps_the_words_so_far(settings: Settings, db: Database, path: str) -> None:
    with client_with(settings, db, SlowAnswers()) as c:
        _, conv = setup_conversation(c)
        sent: dict[str, Any] = {}
        worker = threading.Thread(
            target=lambda: sent.update(
                r=c.post(f"/conversations/{conv['id']}/{path}", json={"text": "long"})
            )
        )
        worker.start()
        deadline = time.monotonic() + 5
        # Wait for the first words, so there is something to keep.
        while c.get(f"/conversations/{conv['id']}/generation").json()["phase"] != "streaming":
            assert time.monotonic() < deadline
            time.sleep(0.01)
        assert c.post("/conversations/other/stop").json() == {"error": "not_generating"}

        stopped = c.post(f"/conversations/{conv['id']}/stop")
        worker.join(5)
        assert stopped.status_code == 200, stopped.text
        msg = stopped.json()
        assert msg["status"] == "stopped" and 0 < len(msg["content"].split()) < 200

        stored = c.get(f"/conversations/{conv['id']}/messages").json()[-1]
        assert stored["status"] == "stopped" and stored["content"] == msg["content"]
        assert c.get(f"/conversations/{conv['id']}/generation").json()["generating"] is False


def test_only_one_answer_at_a_time(settings: Settings, db: Database) -> None:
    with client_with(settings, db, SlowAnswers()) as c:
        _, first = setup_conversation(c)
        _, second = setup_conversation(c)
        worker = threading.Thread(
            target=lambda: c.post(f"/conversations/{first['id']}/messages", json={"text": "a"})
        )
        worker.start()
        while not c.get(f"/conversations/{first['id']}/generation").json()["generating"]:
            time.sleep(0.01)
        busy = c.post(f"/conversations/{second['id']}/messages", json={"text": "b"})
        assert busy.status_code == 409 and busy.json() == {"error": "busy"}
        assert c.get("/system/status").json()["generating_conversation_id"] == first["id"]
        c.post(f"/conversations/{first['id']}/stop")
        worker.join(5)


# ------------------------------------------------------------------ continue locally
def company_client(settings: Settings, db: Database, answers: FakeAnswers) -> TestClient:
    lab = dataclasses.replace(
        settings,
        company_ai=True,
        company_base_url="https://ai.example.internal/v1",
        company_model_name="company-70b",
    )
    return client_with(lab, db, answers)


def test_continue_an_interrupted_company_answer_locally(
    settings: Settings, db: Database, answers: FakeAnswers
) -> None:
    with company_client(settings, db, answers) as c:
        _, conv = setup_conversation(c)
        c.post(f"/conversations/{conv['id']}/provider", json={"to": "company", "confirmed": True})
        answers.fail_after = 2
        partial = c.post(f"/conversations/{conv['id']}/messages", json={"text": "q"}).json()
        assert partial["assistant"]["status"] == "partial"
        answers.fail_after = None

        out = c.post(
            f"/conversations/{conv['id']}/continue-locally",
            json={"partial_message_id": partial["assistant"]["id"]},
        )
        assert out.status_code == 200, out.text
        body = out.json()
        assert body["conversation"]["current_provider"] == "local"
        assert body["user"] is None
        assert body["assistant"]["continued_from"] == partial["assistant"]["id"]
        assert body["assistant"]["provider"] == "local"
        # The partial answer is part of the context, so the model can carry on from it.
        assert answers.calls[-1]["messages"][-1] == {"role": "assistant", "content": "A local"}

        types = [e["event_type"] for e in c.get("/evidence").json()]
        assert types[-3:] == ["provider_changed", "continuation", "inference_completed"]


def test_continue_locally_with_the_pending_message(
    settings: Settings, db: Database, answers: FakeAnswers
) -> None:
    with company_client(settings, db, answers) as c:
        _, conv = setup_conversation(c)
        c.post(f"/conversations/{conv['id']}/provider", json={"to": "company", "confirmed": True})
        out = c.post(f"/conversations/{conv['id']}/continue-locally", json={"text": "pending"})
        body = out.json()
        assert body["user"]["content"] == "pending" and body["user"]["provider"] == "local"
        assert body["assistant"]["status"] == "complete"


def test_continue_locally_checks_its_input(chat: TestClient) -> None:
    _, conv = setup_conversation(chat)
    url = f"/conversations/{conv['id']}/continue-locally"
    assert chat.post(url, json={}).json() == {"error": "invalid_request"}
    both = {"partial_message_id": "x", "text": "y"}
    assert chat.post(url, json=both).json() == {"error": "invalid_request"}
    assert chat.post(url, json={"partial_message_id": "x"}).json() == {"error": "message_not_found"}
    done = chat.post(f"/conversations/{conv['id']}/messages", json={"text": "q"}).json()
    complete = chat.post(url, json={"partial_message_id": done["assistant"]["id"]})
    assert complete.status_code == 409 and complete.json() == {"error": "not_partial"}


def test_continue_locally_without_a_model(client: TestClient) -> None:
    _, conv = setup_conversation(client)
    resp = client.post(f"/conversations/{conv['id']}/continue-locally", json={"text": "x"})
    assert resp.status_code == 409 and resp.json() == {"error": "no_model"}


# ------------------------------------------------------------------ providers
def test_company_details_in_provider_status(
    settings: Settings, db: Database, answers: FakeAnswers
) -> None:
    with company_client(settings, db, answers) as c:
        company = c.get("/providers/status").json()["company"]
        assert company["reachable"] is True
        assert company["base_url"] == "https://ai.example.internal/v1"
        assert company["model_name"] == "company-70b"
        assert "key" not in json.dumps(company).lower()
