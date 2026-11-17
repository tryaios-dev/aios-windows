"""G-03: the input commitment covers what is sent, token counts come from the engine, and an
answer is saved while it is written (a crash keeps the words so far)."""

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from tests.conftest import LAUNCH_TOKEN, LOOPBACK, FakeAnswers
from tests.test_chat import setup_conversation

from aios_backend.apps.chat import service as chat_service
from aios_backend.config import Settings
from aios_backend.main import create_app
from aios_common.canonical import b64url_decode, jcs, tagged_hash
from db.models import Message
from db.session import Database

PROMPT = "You are the test assistant."


class Prepared(FakeAnswers):
    """A source that adds its own system prompt, as the local model does."""

    def prepare(self, provider: str, messages: list[dict[str, str]]) -> list[dict[str, str]]:
        return [{"role": "system", "content": PROMPT}, *messages]


class Usage:
    """An answer stream that reports the engine's own token counts once it has ended."""

    def __init__(self, words: list[str], usage: tuple[int, int]) -> None:
        self._words = iter(words)
        self._usage = usage
        self.usage: tuple[int, int] | None = None

    def __iter__(self) -> "Usage":
        return self

    def __next__(self) -> str:
        try:
            return next(self._words)
        except StopIteration:
            self.usage = self._usage
            raise


class Counted(FakeAnswers):
    def answer(self, provider: str, model_id: str, messages: list[dict[str, str]]) -> Iterator[str]:
        self.calls.append({"messages": messages})
        return Usage(["Counted", " answer."], (123, 7))


def _client(settings: Settings, db: Database, answers: Any) -> TestClient:
    app = create_app(settings, db, answers)
    return TestClient(app, client=LOOPBACK, headers={"Authorization": f"Bearer {LAUNCH_TOKEN}"})


def _last_inference(client: TestClient) -> dict[str, Any]:
    return [e for e in client.get("/evidence").json() if e["event_type"] == "inference_completed"][
        -1
    ]


def test_the_input_commitment_covers_the_system_prompt_the_source_adds(
    settings: Settings, db: Database
) -> None:
    answers = Prepared()
    with _client(settings, db, answers) as c:
        _, conv = setup_conversation(c)
        out = c.post(f"/conversations/{conv['id']}/messages", json={"text": "secret text"}).json()
        sent = answers.calls[-1]["messages"]
        assert sent[0] == {"role": "system", "content": PROMPT}  # what the engine received
        event = _last_inference(c)
    with db.session() as s:
        msg = s.get(Message, out["assistant"]["id"])
        assert msg is not None and msg.input_nonce
        expected = tagged_hash(
            "aios/evidence/v1/commit/input",
            b64url_decode(msg.input_nonce) + jcs({"model": "qwen3-8b-q4km", "messages": sent}),
        )
    assert event["payload"]["input_commitment"] == expected


def test_token_counts_are_the_engines_when_it_reports_them(
    settings: Settings, db: Database
) -> None:
    with _client(settings, db, Counted()) as c:
        _, conv = setup_conversation(c)
        out = c.post(f"/conversations/{conv['id']}/messages", json={"text": "count me"}).json()
        assert out["assistant"]["content"] == "Counted answer."
        assert (out["assistant"]["prompt_tokens"], out["assistant"]["completion_tokens"]) == (
            123,
            7,
        )
        payload = _last_inference(c)["payload"]
    assert (payload["tokens_in"], payload["tokens_out"]) == (123, 7)


@pytest.mark.parametrize("path", ["messages", "messages/stream"])
def test_the_answer_is_saved_while_it_is_written(
    settings: Settings, db: Database, monkeypatch: pytest.MonkeyPatch, path: str
) -> None:
    monkeypatch.setattr(chat_service, "SAVE_EVERY_S", 0.0)
    seen: list[tuple[str, str]] = []

    class Watched(FakeAnswers):
        def answer(
            self, provider: str, model_id: str, messages: list[dict[str, str]]
        ) -> Iterator[str]:
            yield "Half an"
            # Before the next words: what a crash at this moment would leave in chats.db.
            with db.session() as s:
                row = (
                    s.query(Message)
                    .filter(Message.role == "assistant")
                    .order_by(Message.position.desc())
                    .first()
                )
                assert row is not None
                seen.append((row.content, row.status))
            yield " answer."

    with _client(settings, db, Watched()) as c:
        _, conv = setup_conversation(c)
        resp = c.post(f"/conversations/{conv['id']}/{path}", json={"text": "write slowly"})
        assert resp.status_code in (200, 201)
    assert seen == [("Half an", "partial")]
    with db.session() as s:
        row = s.query(Message).filter(Message.role == "assistant").one()
        assert (row.content, row.status) == ("Half an answer.", "complete")
