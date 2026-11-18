"""G-04: what fits the model's context is decided by the engine's own token count when the engine
has the model loaded; the estimate (characters / 3.5) is only the fallback."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from tests.conftest import LAUNCH_TOKEN, LOOPBACK, FakeAnswers

from aios_backend.apps.chat.service import SUMMARY_INSTRUCTION
from aios_backend.config import Settings
from aios_backend.main import create_app
from db.session import Database


class CountingAnswers(FakeAnswers):
    """An answer source whose engine counts one token per character (3.5 times the estimate).
    ``loaded = False`` stands for an engine that has not loaded the model: no count."""

    def __init__(self, context_length: int) -> None:
        super().__init__("Noted.", context_length=context_length)
        self.loaded = True
        self.counted: list[str] = []

    def count_tokens(self, provider: str, model_id: str, text: str) -> int | None:
        if not self.loaded:
            return None
        self.counted.append(text)
        return len(text)


@pytest.fixture
def model() -> CountingAnswers:
    return CountingAnswers(context_length=2000)  # budget: 2000 - 1500 - 220 = 280 tokens


@pytest.fixture
def api(settings: Settings, db: Database, model: CountingAnswers) -> Iterator[TestClient]:
    headers = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}
    with TestClient(create_app(settings, db, model), client=LOOPBACK, headers=headers) as c:
        yield c


def conversation(api: TestClient) -> str:
    project = api.post("/projects", json={"name": "P", "classification": "internal"}).json()
    return str(api.post(f"/projects/{project['id']}/conversations", json={}).json()["id"])


def test_g04_the_engine_count_decides_whether_a_message_fits(
    api: TestClient, model: CountingAnswers
) -> None:
    conv = conversation(api)
    text = "x" * 500  # estimate 143 tokens (fits); the engine counts 500 (does not)
    resp = api.post(f"/conversations/{conv}/messages", json={"text": text})
    assert (resp.status_code, resp.json()) == (413, {"error": "message_too_large"})
    refusal = api.get("/evidence").json()[-1]
    assert refusal["event_type"] == "refusal" and refusal["payload"]["tokens"] == 500


def test_g04_without_a_loaded_engine_the_estimate_is_used(
    api: TestClient, model: CountingAnswers
) -> None:
    model.loaded = False
    conv = conversation(api)
    resp = api.post(f"/conversations/{conv}/messages", json={"text": "x" * 500})
    assert resp.status_code == 200, resp.text


def test_g04_history_is_packed_by_the_engine_count(settings: Settings, db: Database) -> None:
    """Three short messages fit by the estimate, not by the engine's count: the earlier part is
    summarised and only the newest messages are sent."""
    model = CountingAnswers(context_length=2400)  # budget 680 tokens
    headers = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}
    with TestClient(create_app(settings, db, model), client=LOOPBACK, headers=headers) as api:
        conv = conversation(api)
        question = "Please look at the supplier list. " * 9  # 306 characters: 88 estimated
        for _ in range(3):
            resp = api.post(f"/conversations/{conv}/messages", json={"text": question})
            assert resp.status_code == 200
            api.app.state.generations.background.wait(10)  # type: ignore[attr-defined]
    summaries = [c for c in model.calls if c["messages"][0]["content"] == SUMMARY_INSTRUCTION]
    assert summaries, "the history was not packed by the engine's count"
    last = [c for c in model.calls if c not in summaries][-1]["messages"]
    assert sum(len(m["content"]) for m in last if m["role"] != "system") <= 680
