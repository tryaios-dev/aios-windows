"""Voice notes: a recording file turned into text, on PR #17's speech engine.

The window decodes the file into the audio dictation sends and sends it in parts; a job turns it
into text phrase by phrase, with progress and Stop. The text goes into a conversation; Activity
records that it happened, never the text, and the logs hold no words.
"""

import dataclasses
import logging
import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from tests.conftest import LAUNCH_TOKEN, LOOPBACK
from tests.test_voice import FakeWhisper, Starts, b64, make_manager, quiet, tone

from aios_backend.apps.voice.service import Recordings, Sessions
from aios_backend.config import Settings
from aios_backend.main import create_app
from db.session import Database

PART_S = 30.0


@pytest.fixture
def notes(settings: Settings, db: Database, tmp_path: Path) -> Iterator[tuple[TestClient, Starts]]:
    starts = Starts()
    manager = make_manager(tmp_path, starts)
    app = create_app(dataclasses.replace(settings, voice_root=tmp_path / "whisper"), db)
    headers = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}
    with TestClient(app, client=LOOPBACK, headers=headers) as c:
        app.state.voice = manager
        app.state.voice_sessions = Sessions(manager)
        app.state.voice_recordings = Recordings(manager)
        yield c, starts
    starts.cleanup()


def recording(phrases: int) -> bytes:
    """``phrases`` phrases of speech, each followed by a pause."""
    return quiet(0.5) + b"".join(tone(1.5) + quiet(1.0) for _ in range(phrases))


def parts(pcm: bytes, seconds: float = PART_S) -> Iterator[bytes]:
    step = int(16_000 * 2 * seconds)
    for i in range(0, len(pcm), step):
        yield pcm[i : i + step]


def seconds(pcm: bytes) -> float:
    return len(pcm) / 32_000


def conversation(c: TestClient) -> tuple[str, str]:
    project = c.post("/projects", json={"name": "P", "classification": "internal"}).json()
    conv = c.post(f"/projects/{project['id']}/conversations", json={}).json()
    return project["id"], conv["id"]


def until_done(c: TestClient, job: str) -> dict[str, object]:
    for _ in range(200):
        body: dict[str, object] = c.get(f"/voice/recordings/{job}").json()
        if body["state"] != "working":
            return body
        time.sleep(0.02)
    raise AssertionError("the recording was not turned into text")


def test_recordings_need_the_voice_notes_skill(notes: tuple[TestClient, Starts]) -> None:
    c, starts = notes
    r = c.post("/voice/recordings", json={"seconds": 10})
    assert (r.status_code, r.json()) == (409, {"error": "skill_not_enabled"})
    c.post("/skills/voice")
    c.put("/skills/voice/enabled", json={"enabled": False})
    assert c.post("/voice/recordings", json={"seconds": 10}).json() == {
        "error": "skill_not_enabled"
    }
    assert starts.started == []  # the speech engine was not even started


def test_a_recording_becomes_text_with_progress_and_goes_into_a_conversation(
    notes: tuple[TestClient, Starts], caplog: pytest.LogCaptureFixture
) -> None:
    c, starts = notes
    assert c.post("/skills/voice").status_code == 200
    project_id, conversation_id = conversation(c)
    pcm = recording(30)  # 75.5 s: three parts
    caplog.set_level(logging.INFO)

    job = c.post("/voice/recordings", json={"seconds": seconds(pcm)}).json()
    assert (job["state"], job["done_s"], job["total_s"]) == ("working", 0, 75.5)
    done = []
    for part in parts(pcm):
        r = c.post(f"/voice/recordings/{job['recording_id']}/audio", json={"pcm": b64(part)})
        assert r.status_code == 200, r.text
        assert r.json()["backlog_s"] == 60
        done.append(r.json()["done_s"])
    assert done == sorted(done) and done[-1] > 0  # progress only goes forward
    c.post(f"/voice/recordings/{job['recording_id']}/end")
    finished = until_done(c, job["recording_id"])
    assert (finished["state"], finished["done_s"]) == ("done", 75.5)

    r = c.post(
        f"/voice/recordings/{job['recording_id']}/take",
        json={"conversation_id": conversation_id},
    )
    assert r.status_code == 200
    text = r.json()["text"]
    assert len(text.split()) == 30  # every phrase, in order
    assert c.get(f"/voice/recordings/{job['recording_id']}").status_code == 404  # taken: gone
    assert starts.started == ["cpu"]

    event = next(e for e in c.get("/evidence").json() if e["event_type"] == "recording_transcribed")
    assert (event["project_id"], event["conversation_id"]) == (project_id, conversation_id)
    assert event["payload"] == {"seconds": 76, "phrases": 30, "stopped": False}
    words = set(text.split())  # the fake engine writes each phrase as "phrase<length>-<language>"
    assert not any(
        w in caplog.text or w in str(event) for w in words
    )  # no words in logs or Activity


def test_stop_keeps_the_text_so_far(notes: tuple[TestClient, Starts]) -> None:
    c, _ = notes
    c.post("/skills/voice")
    _, conversation_id = conversation(c)
    pcm = recording(30)
    job = c.post("/voice/recordings", json={"seconds": seconds(pcm)}).json()["recording_id"]
    first = next(parts(pcm))
    c.post(f"/voice/recordings/{job}/audio", json={"pcm": b64(first)})
    for _ in range(100):  # the first part's phrases are turned into text
        if c.get(f"/voice/recordings/{job}").json()["waiting_s"] < 3:
            break
        time.sleep(0.02)

    stopped = c.post(f"/voice/recordings/{job}/stop").json()
    assert stopped["state"] == "stopped" and 0 < stopped["done_s"] < stopped["total_s"]
    r = c.post(f"/voice/recordings/{job}/audio", json={"pcm": b64(first)})
    assert (r.status_code, r.json()) == (409, {"error": "voice_recording_ended"})
    text = c.post(f"/voice/recordings/{job}/take", json={"conversation_id": conversation_id})
    assert 0 < len(text.json()["text"].split()) < 30
    event = next(e for e in c.get("/evidence").json() if e["event_type"] == "recording_transcribed")
    assert event["payload"]["stopped"] is True


def test_discard_throws_the_text_away_and_records_nothing(
    notes: tuple[TestClient, Starts],
) -> None:
    c, _ = notes
    c.post("/skills/voice")
    pcm = recording(4)
    job = c.post("/voice/recordings", json={"seconds": seconds(pcm)}).json()["recording_id"]
    c.post(f"/voice/recordings/{job}/audio", json={"pcm": b64(pcm)})
    assert c.delete(f"/voice/recordings/{job}").status_code == 204
    assert c.post(f"/voice/recordings/{job}/take", json={}).status_code == 404
    assert c.delete(f"/voice/recordings/{job}").status_code == 204  # already gone is fine
    events = [e["event_type"] for e in c.get("/evidence").json()]
    assert "recording_transcribed" not in events


def test_the_text_is_taken_only_once_it_is_done(notes: tuple[TestClient, Starts]) -> None:
    c, _ = notes
    c.post("/skills/voice")
    job = c.post("/voice/recordings", json={"seconds": 60}).json()["recording_id"]
    r = c.post(f"/voice/recordings/{job}/take", json={})
    assert (r.status_code, r.json()) == (409, {"error": "voice_recording_not_done"})


def test_limits(notes: tuple[TestClient, Starts]) -> None:
    c, _ = notes
    c.post("/skills/voice")
    # Two hours at most: the window holds the decoded recording in memory.
    assert c.post("/voice/recordings", json={"seconds": 7201}).status_code == 422
    job = c.post("/voice/recordings", json={"seconds": 2}).json()["recording_id"]
    r = c.post(f"/voice/recordings/{job}/audio", json={"pcm": b64(tone(4))})
    assert (r.status_code, r.json()) == (409, {"error": "voice_too_long"})  # more than it said
    big = "A" * 1_400_000  # a part over 30 s
    assert c.post(f"/voice/recordings/{job}/audio", json={"pcm": big}).status_code == 422
    unknown = c.post(
        f"/voice/recordings/{job}/take", json={"conversation_id": "0" * 32}
    )  # not done yet comes first
    assert unknown.status_code == 409


def test_text_for_an_unknown_conversation_is_refused(notes: tuple[TestClient, Starts]) -> None:
    c, _ = notes
    c.post("/skills/voice")
    pcm = recording(2)
    job = c.post("/voice/recordings", json={"seconds": seconds(pcm)}).json()["recording_id"]
    c.post(f"/voice/recordings/{job}/audio", json={"pcm": b64(pcm)})
    c.post(f"/voice/recordings/{job}/end")
    until_done(c, job)
    r = c.post(f"/voice/recordings/{job}/take", json={"conversation_id": "0" * 32})
    assert (r.status_code, r.json()) == (404, {"error": "conversation_not_found"})


def test_recordings_need_the_launch_token(anonymous: TestClient) -> None:
    assert anonymous.post("/voice/recordings", json={"seconds": 1}).status_code == 401


def test_a_recording_checks_the_language_of_every_phrase(notes: tuple[TestClient, Starts]) -> None:
    """A meeting can change language part way: unlike dictation, a clear phrase does not decide
    the language for the rest (measured: the Italian half of a recording came out in English)."""
    c, _ = notes
    c.post("/skills/voice")
    c.patch("/settings", json={"voice_languages": ["it", "en"]})
    FakeWhisper.scores, FakeWhisper.calls = {"en": 0.9, "it": 0.05}, []
    pcm = quiet(0.5) + tone(3) + quiet(1) + tone(3) + quiet(1)  # two long, clear phrases
    job = c.post("/voice/recordings", json={"seconds": seconds(pcm)}).json()["recording_id"]
    c.post(f"/voice/recordings/{job}/audio", json={"pcm": b64(pcm)})
    c.post(f"/voice/recordings/{job}/end")
    until_done(c, job)
    assert FakeWhisper.calls == ["detect", "transcribe:en", "detect", "transcribe:en"]
