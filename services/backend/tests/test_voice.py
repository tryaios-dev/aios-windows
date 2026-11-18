"""Voice (ADR 0016): phrases cut at pauses, the whisper-server process manager, the dictation
API, and an end-to-end run on the real whisper-server when one is built.

The stand-ins below make the first three run everywhere in seconds. The real server needs
AIOS_WHISPER_SERVER, AIOS_WHISPER_MODEL and AIOS_WHISPER_SAMPLE (CI: whisper-linux, as for
tests/voice/test_whisper_server.py).
"""

import asyncio
import base64
import dataclasses
import hashlib
import math
import os
import shutil
import subprocess
import sys
import wave
from array import array
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from tests.conftest import LAUNCH_TOKEN, LOOPBACK

from aios_backend.apps.voice.service import Sessions
from aios_backend.config import Settings
from aios_backend.engine.job import ChildJob, kill_on_close_job
from aios_backend.main import create_app
from aios_backend.voice import (
    VoiceError,
    VoiceManager,
    VoiceState,
    Whisper,
    languages,
    launcher,
    phrases,
)
from aios_backend.voice.launcher import EXE
from aios_backend.voice.manager import MODEL_FILE
from db.session import Database

RATE = phrases.RATE


# ------------------------------------------------------------------ synthetic audio
def tone(seconds: float, amplitude: int = 6000) -> bytes:
    """Speech stand-in: a loud 220 Hz tone."""
    n = round(seconds * RATE)
    a = array("h", (round(amplitude * math.sin(2 * math.pi * 220 * i / RATE)) for i in range(n)))
    if sys.byteorder == "big":
        a.byteswap()
    return a.tobytes()


def quiet(seconds: float, amplitude: int = 60) -> bytes:
    return tone(seconds, amplitude)


def chunks(pcm: bytes, seconds: float = 0.25) -> Iterator[bytes]:
    size = round(seconds * RATE) * 2
    for start in range(0, len(pcm), size):
        yield pcm[start : start + size]


def feed(p: phrases.Phrases, pcm: bytes) -> list[bytes]:
    out = []
    for chunk in chunks(pcm):
        out += p.add(chunk)
    return out


def seconds(pcm: bytes) -> float:
    return len(pcm) / (RATE * 2)


# ------------------------------------------------------------------ phrases
def test_a_pause_ends_a_phrase() -> None:
    p = phrases.Phrases()
    out = feed(p, quiet(1) + tone(1.5) + quiet(1) + tone(1) + quiet(1))
    assert len(out) == 2
    assert 1.5 <= seconds(out[0]) <= 2.3  # the speech, a little lead-in and part of the pause
    assert 1.0 <= seconds(out[1]) <= 1.8


def test_silence_is_never_sent_to_whisper() -> None:
    p = phrases.Phrases()
    assert feed(p, quiet(10)) == []
    assert p.seconds <= phrases.LEAD_S + 0.25  # leading silence is not kept
    assert p.flush() is None


def test_a_click_is_not_speech() -> None:
    p = phrases.Phrases()
    assert feed(p, quiet(1) + tone(0.1) + quiet(1.5)) == []


def test_speech_that_runs_on_is_cut_near_its_quietest_moment() -> None:
    p = phrases.Phrases()
    out = feed(p, tone(12) + tone(0.3, 400) + tone(12))  # a soft dip at 12 s, no real pause
    assert out, "a phrase longer than MAX_PHRASE_S must be cut"
    assert seconds(out[0]) <= phrases.MAX_PHRASE_S + 0.3


def test_done_returns_the_rest() -> None:
    p = phrases.Phrases()
    assert feed(p, quiet(0.5) + tone(1)) == []  # still talking
    last = p.flush()
    assert last is not None and seconds(last) >= 1.0
    assert p.flush() is None


def test_the_room_level_is_learned() -> None:
    # A noisy room (well above the floor) is not speech once it has been heard for a moment.
    p = phrases.Phrases()
    assert feed(p, quiet(3, amplitude=500)) == []
    assert len(feed(p, tone(1.5, 8000) + quiet(1, amplitude=500))) == 1


def test_whisper_markers_are_not_words() -> None:
    assert phrases.clean(" [BLANK_AUDIO] ") == ""
    assert phrases.clean(" Hello (music) world. ") == "Hello world."


def test_the_window_is_fitted_to_the_audio() -> None:
    assert phrases.audio_ctx(tone(2)) == 2 * 50 + 64
    assert phrases.audio_ctx(tone(40)) == 1500


def test_a_phrase_is_a_16_khz_mono_wav() -> None:
    import io

    with wave.open(io.BytesIO(phrases.wav(tone(1)))) as w:
        assert (w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()) == (
            1,
            2,
            RATE,
            RATE,
        )


# ------------------------------------------------------------------ process manager
class FakeWhisper(Whisper):
    """A sleeping Python process that 'transcribes' each phrase as its length and language.
    ``scores``: what its language guess returns; ``calls`` records what was asked."""

    scores: dict[str, float] = {}
    calls: list[str] = []

    def transcribe(self, wav: bytes, audio_ctx: int, language: str = "auto") -> str:
        if not self.alive():
            raise VoiceError("voice_unreachable")
        FakeWhisper.calls.append(f"transcribe:{language}")
        return f"phrase{audio_ctx}-{language}"

    def detect(self, wav: bytes, audio_ctx: int) -> dict[str, float]:
        FakeWhisper.calls.append("detect")
        return dict(FakeWhisper.scores)


class Starts:
    def __init__(self, fail: set[str] | None = None) -> None:
        self.fail = fail or set()
        self.started: list[str] = []
        self.made: list[Whisper] = []

    def __call__(
        self, voice_dir: Path, model: Path, temp: Path, job: ChildJob, build: str
    ) -> Whisper:
        assert voice_dir.name == build
        self.started.append(build)
        if build in self.fail:
            raise VoiceError("voice_exit_on_start")
        proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])
        job.assign(proc)
        w = FakeWhisper(proc, 0, "key", model, build)
        self.made.append(w)
        return w

    def cleanup(self) -> None:
        for w in self.made:
            if w.alive():
                w.process.kill()
                w.process.wait()


MODEL_BYTES = b"not really whisper"
MODEL_DIGEST = hashlib.sha256(MODEL_BYTES).hexdigest()


def make_manager(
    tmp_path: Path,
    starts: Starts,
    *,
    built: tuple[str, ...] = ("cpu",),
    model: bytes | None = MODEL_BYTES,
    **kw: Any,
) -> VoiceManager:
    root = tmp_path / "whisper"
    for build in built:
        (root / build).mkdir(parents=True, exist_ok=True)
        (root / build / EXE).write_bytes(b"")
    models = tmp_path / "models"
    models.mkdir(parents=True, exist_ok=True)
    if model is not None:
        (models / MODEL_FILE).write_bytes(model)
    job = kill_on_close_job()
    return VoiceManager(
        root,
        models,
        tmp_path / "voice-tmp",
        lambda: job,
        start_fn=starts,
        model_sha256=MODEL_DIGEST,
        watch_interval_s=0.05,
        **{"prime": False, **kw},
    )


def test_states_before_anything_runs(tmp_path: Path) -> None:
    starts = Starts()
    assert make_manager(tmp_path / "a", starts, built=()).state() == (VoiceState.NOT_BUILT, None)
    assert make_manager(tmp_path / "b", starts, model=None).state() == (VoiceState.NO_MODEL, None)
    assert make_manager(tmp_path / "c", starts).state() == (VoiceState.NOT_STARTED, None)
    assert starts.started == []


def test_starts_on_first_use_and_once(tmp_path: Path) -> None:
    starts = Starts()
    m = make_manager(tmp_path, starts)

    async def body() -> None:
        first = await m.ensure()
        assert await m.ensure() is first
        assert m.state() == (VoiceState.READY, "cpu")
        await m.shutdown()

    try:
        asyncio.run(body())
    finally:
        starts.cleanup()
    assert starts.started == ["cpu"]


def test_only_the_expected_model_file_is_loaded(tmp_path: Path) -> None:
    starts = Starts()
    m = make_manager(tmp_path, starts, model=b"some other model")
    with pytest.raises(VoiceError, match="voice_no_model"):
        asyncio.run(m.ensure())
    assert starts.started == []


def test_not_built_is_reported(tmp_path: Path) -> None:
    m = make_manager(tmp_path, Starts(), built=())
    with pytest.raises(VoiceError, match="voice_not_built"):
        asyncio.run(m.ensure())


def test_gpu_build_when_the_engine_found_a_gpu_else_cpu(tmp_path: Path) -> None:
    starts = Starts()
    gpu = make_manager(tmp_path / "gpu", starts, built=("cpu", "vulkan"), prefer_gpu=lambda: True)
    cpu = make_manager(tmp_path / "cpu", starts, built=("cpu", "vulkan"), prefer_gpu=lambda: False)

    async def body() -> None:
        assert (await gpu.ensure()).build == "vulkan"
        assert (await cpu.ensure()).build == "cpu"
        await gpu.shutdown()
        await cpu.shutdown()

    try:
        asyncio.run(body())
    finally:
        starts.cleanup()


def test_a_gpu_build_that_fails_falls_back_to_cpu(tmp_path: Path) -> None:
    starts = Starts(fail={"vulkan"})
    m = make_manager(tmp_path, starts, built=("cpu", "vulkan"), prefer_gpu=lambda: True)

    async def body() -> None:
        assert (await m.ensure()).build == "cpu"
        await m.shutdown()

    try:
        asyncio.run(body())
    finally:
        starts.cleanup()
    assert starts.started == ["vulkan", "cpu"]


def test_a_crash_is_noticed_and_the_next_use_restarts_it(tmp_path: Path) -> None:
    starts = Starts()
    m = make_manager(tmp_path, starts)

    async def body() -> None:
        first = await m.ensure()
        first.process.kill()
        first.process.wait()
        second = await m.ensure()
        assert second is not first and second.alive()
        await m.shutdown()

    try:
        asyncio.run(body())
    finally:
        starts.cleanup()


def test_idle_server_is_stopped(tmp_path: Path) -> None:
    starts = Starts()
    m = make_manager(tmp_path, starts, idle_unload_s=0.1)

    async def body() -> None:
        await m.startup()
        w = await m.ensure()
        for _ in range(100):
            await asyncio.sleep(0.05)
            if not w.alive():
                break
        assert not w.alive()
        assert m.state() == (VoiceState.NOT_STARTED, None)
        await m.shutdown()

    try:
        asyncio.run(body())
    finally:
        starts.cleanup()


# ------------------------------------------------------------------ API
@pytest.fixture
def voice_client(
    settings: Settings, db: Database, tmp_path: Path
) -> Iterator[tuple[TestClient, Starts]]:
    starts = Starts()
    manager = make_manager(tmp_path, starts)
    app = create_app(dataclasses.replace(settings, voice_root=tmp_path / "whisper"), db)
    headers = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}
    with TestClient(app, client=LOOPBACK, headers=headers) as c:
        app.state.voice = manager
        app.state.voice_sessions = Sessions(manager)
        yield c, starts
    starts.cleanup()


def b64(pcm: bytes) -> str:
    return base64.b64encode(pcm).decode()


def test_dictation_phrase_by_phrase(voice_client: tuple[TestClient, Starts]) -> None:
    c, starts = voice_client
    status = c.get("/voice/status").json()
    assert (status["state"], status["build"], status["model"]["status"]) == (
        "not_started",
        None,
        "ready",
    )
    session = c.post("/voice/sessions").json()["session_id"]
    assert (c.get("/voice/status").json()["state"], c.get("/voice/status").json()["build"]) == (
        "ready",
        "cpu",
    )

    texts = []
    for chunk in chunks(quiet(0.5) + tone(1.5) + quiet(1) + tone(1)):
        r = c.post(f"/voice/sessions/{session}/audio", json={"pcm": b64(chunk)})
        assert r.status_code == 200, r.text
        texts.append(r.json()["text"])
    assert texts[0] == ""
    assert any(t.startswith("phrase") for t in texts), "the first phrase appears before Done"

    done = c.post(f"/voice/sessions/{session}/finish")
    assert done.status_code == 200
    assert len(done.json()["text"].split()) == 2  # both phrases, in order
    assert c.post(f"/voice/sessions/{session}/audio", json={"pcm": ""}).status_code == 404
    assert starts.started == ["cpu"]


def test_cancel_throws_it_away(voice_client: tuple[TestClient, Starts]) -> None:
    c, _ = voice_client
    session = c.post("/voice/sessions").json()["session_id"]
    c.post(f"/voice/sessions/{session}/audio", json={"pcm": b64(tone(1))})
    assert c.delete(f"/voice/sessions/{session}").status_code == 204
    assert c.post(f"/voice/sessions/{session}/finish").status_code == 404
    assert c.delete(f"/voice/sessions/{session}").status_code == 204  # already gone is fine


def test_a_new_session_ends_the_old_one(voice_client: tuple[TestClient, Starts]) -> None:
    c, _ = voice_client
    first = c.post("/voice/sessions").json()["session_id"]
    second = c.post("/voice/sessions").json()["session_id"]
    assert first != second
    assert c.post(f"/voice/sessions/{first}/finish").status_code == 404
    assert c.post(f"/voice/sessions/{second}/finish").status_code == 200


@pytest.mark.parametrize(
    "pcm",
    ["not base64!", "A" * 90_000],  # not base64; more than 2 s of audio in one call
    # Short ids: pytest puts the id in an environment variable, which Windows caps at 32767.
    ids=["not_base64", "too_long"],
)
def test_bad_audio_is_refused(voice_client: tuple[TestClient, Starts], pcm: str) -> None:
    c, _ = voice_client
    session = c.post("/voice/sessions").json()["session_id"]
    r = c.post(f"/voice/sessions/{session}/audio", json={"pcm": pcm})
    assert r.status_code == 422 and r.json() == {"error": "invalid_request"}


def test_not_built_and_no_model_are_clear_errors(
    settings: Settings, db: Database, tmp_path: Path
) -> None:
    headers = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}
    empty = dataclasses.replace(settings, voice_root=tmp_path / "nothing")
    with TestClient(create_app(empty, db), client=LOOPBACK, headers=headers) as c:
        assert c.get("/voice/status").json()["state"] == "not_built"
        assert c.post("/voice/sessions").json() == {"error": "voice_not_built"}
    built = tmp_path / "built"
    (built / "cpu").mkdir(parents=True)
    (built / "cpu" / EXE).write_bytes(b"")
    with TestClient(
        create_app(dataclasses.replace(settings, voice_root=built), db),
        client=LOOPBACK,
        headers=headers,
    ) as c:
        assert c.get("/voice/status").json()["state"] == "no_model"
        r = c.post("/voice/sessions")
        assert (r.status_code, r.json()) == (409, {"error": "voice_no_model"})


def test_voice_needs_the_launch_token(anonymous: TestClient) -> None:
    assert anonymous.get("/voice/status").status_code == 401
    assert anonymous.post("/voice/sessions").status_code == 401


# ------------------------------------------------------------------ the real whisper-server
SERVER = os.environ.get("AIOS_WHISPER_SERVER")
MODEL = os.environ.get("AIOS_WHISPER_MODEL")
SAMPLE = os.environ.get("AIOS_WHISPER_SAMPLE")
real = pytest.mark.skipif(
    not (SERVER and MODEL and SAMPLE),
    reason="set AIOS_WHISPER_SERVER, AIOS_WHISPER_MODEL and AIOS_WHISPER_SAMPLE",
)


def _real_manager(tmp_path: Path) -> VoiceManager:
    """The built server copied as voice_root/cpu, the test model as the voice model."""
    assert SERVER and MODEL
    root = tmp_path / "whisper"
    shutil.copytree(Path(SERVER).parent, root / "cpu", symlinks=True)
    models = tmp_path / "models"
    models.mkdir()
    shutil.copy(MODEL, models / MODEL_FILE)
    digest = hashlib.sha256(Path(MODEL).read_bytes()).hexdigest()
    job = kill_on_close_job()
    return VoiceManager(root, models, tmp_path / "voice-tmp", lambda: job, model_sha256=digest)


def _sample_pcm() -> bytes:
    assert SAMPLE
    with wave.open(SAMPLE) as w:
        assert (w.getframerate(), w.getnchannels(), w.getsampwidth()) == (RATE, 1, 2)
        return w.readframes(w.getnframes())


@real
def test_real_dictation_of_the_sample(tmp_path: Path) -> None:
    m = _real_manager(tmp_path)
    sessions = Sessions(m)

    async def body() -> str:
        session = await sessions.open()
        for chunk in chunks(_sample_pcm()):
            await sessions.audio(session.id, chunk)
        return await sessions.finish(session.id)

    async def run() -> str:
        try:
            return await body()
        finally:
            await m.shutdown()

    text = asyncio.run(run())
    words = " ".join("".join(ch for ch in text.lower() if ch.isalnum() or ch.isspace()).split())
    assert "ask not what your country can do for you" in words


@real
def test_real_server_key_stays_out_of_its_command_line(tmp_path: Path) -> None:
    m = _real_manager(tmp_path)

    async def body() -> None:
        w = await m.ensure()
        if sys.platform != "win32":
            for name in ("cmdline", "environ"):
                assert w.key.encode() not in Path(f"/proc/{w.process.pid}/{name}").read_bytes()
        assert w.key == launcher.derive(launcher.VOICE_PURPOSE)
        await m.shutdown()

    asyncio.run(body())


# ------------------------------------------------------------------ languages (Settings > Voice)
def test_language_choice_among_the_languages_spoken() -> None:
    # Whisper said Latin for a short Italian phrase (measured): among it/en, Italian wins.
    assert languages.choose({"la": 0.54, "it": 0.30, "en": 0.02}, ["it", "en"]) == ("it", True)
    # No listed language clearly ahead: the main one.
    assert languages.choose({"it": 0.2, "en": 0.25}, ["it", "en"]) == ("it", False)
    assert languages.choose({}, ["en", "it"]) == ("en", False)
    assert languages.valid(["it", "en"]) and not languages.valid(["it", "xx"])
    assert not languages.valid(["it", "it"]) and not languages.valid(["en"] * 6)


def _dictate(c: TestClient, pcm: bytes, body: dict[str, Any] | None = None) -> str:
    session = c.post("/voice/sessions", json=body).json()["session_id"]
    for chunk in chunks(pcm):
        assert (
            c.post(f"/voice/sessions/{session}/audio", json={"pcm": b64(chunk)}).status_code == 200
        )
    text: str = c.post(f"/voice/sessions/{session}/finish").json()["text"]
    return text


TWO_PHRASES = quiet(0.5) + tone(3) + quiet(1) + tone(1) + quiet(1)


def test_one_language_is_always_used_without_guessing(
    voice_client: tuple[TestClient, Starts],
) -> None:
    c, _ = voice_client
    assert c.patch("/settings", json={"voice_languages": ["it"]}).json()["voice_languages"] == [
        "it"
    ]
    FakeWhisper.calls = []
    _dictate(c, TWO_PHRASES, {"languages": ["en"]})  # the setting wins over the suggestion
    assert FakeWhisper.calls == ["transcribe:it", "transcribe:it"]


def test_a_clear_long_phrase_settles_the_language(voice_client: tuple[TestClient, Starts]) -> None:
    c, _ = voice_client
    c.patch("/settings", json={"voice_languages": ["en", "it"]})
    FakeWhisper.scores, FakeWhisper.calls = {"la": 0.5, "it": 0.4, "en": 0.05}, []
    _dictate(c, TWO_PHRASES)
    # The 3 s phrase is guessed once and settles Italian; the next one is not guessed again.
    assert FakeWhisper.calls == ["detect", "transcribe:it", "transcribe:it"]


def test_unclear_short_phrases_use_the_main_language(
    voice_client: tuple[TestClient, Starts],
) -> None:
    c, _ = voice_client
    c.patch("/settings", json={"voice_languages": ["it", "en"]})
    FakeWhisper.scores, FakeWhisper.calls = {"en": 0.3, "it": 0.25}, []
    _dictate(c, quiet(0.5) + tone(1) + quiet(1) + tone(1) + quiet(1))
    assert FakeWhisper.calls == ["detect", "transcribe:it", "detect", "transcribe:it"]


def test_without_a_choice_the_computers_languages_are_used(
    voice_client: tuple[TestClient, Starts],
) -> None:
    c, _ = voice_client
    FakeWhisper.calls = []
    _dictate(c, TWO_PHRASES, {"languages": ["xx", "en"]})  # unknown codes dropped
    assert FakeWhisper.calls == ["transcribe:en", "transcribe:en"]
    FakeWhisper.calls = []
    _dictate(c, TWO_PHRASES)
    assert FakeWhisper.calls == ["transcribe:auto", "transcribe:auto"]


def test_the_languages_setting_is_checked_and_can_be_cleared(client: TestClient) -> None:
    assert client.get("/settings").json()["voice_languages"] is None
    assert client.patch("/settings", json={"voice_languages": ["it", "en"]}).json()[
        "voice_languages"
    ] == ["it", "en"]
    for bad in (["klingon"], ["it", "it"], ["en", "it", "de", "fr", "es", "pt"]):
        assert client.patch("/settings", json={"voice_languages": bad}).status_code == 422
    assert client.get("/settings").json()["voice_languages"] == ["it", "en"]
    assert client.patch("/settings", json={"voice_languages": []}).json()["voice_languages"] is None


# ------------------------------------------------------------------ the speech model download
class FakeOrigin:
    """Serves ``data``; ``drop_after`` bytes into the first request the connection drops."""

    def __init__(self, data: bytes, drop_after: int | None = None) -> None:
        self.data, self.drop_after, self.offsets = data, drop_after, []

    def __call__(self, url: str, offset: int) -> Iterator[bytes]:
        self.offsets.append(offset)
        end = len(self.data)
        if self.drop_after is not None:
            end, self.drop_after = offset + self.drop_after, None
            yield self.data[offset:end]
            raise OSError("connection reset")
        for i in range(offset, end, 7):
            yield self.data[i : min(i + 7, end)]


def _wait_download(m: VoiceManager) -> None:
    import time

    for _ in range(200):
        if m.downloader.state.status in ("done", "failed"):
            return
        time.sleep(0.02)


def test_the_speech_model_downloads_resumes_and_is_checked(tmp_path: Path) -> None:
    origin = FakeOrigin(MODEL_BYTES, drop_after=5)
    m = make_manager(tmp_path, Starts(), model=None, fetch_fn=origin, model_size=len(MODEL_BYTES))
    m.downloader._delays = (0.01,)  # noqa: SLF001 - no waiting in a test
    assert m.state()[0] is VoiceState.NO_MODEL
    m.downloader.start()
    _wait_download(m)
    assert m.downloader.state.status == "done"
    assert origin.offsets == [0, 5]  # carried on from where the connection dropped
    assert m.model_path.read_bytes() == MODEL_BYTES
    assert not m.downloader.part.exists()
    assert m.state()[0] is VoiceState.NOT_STARTED  # usable now


def test_a_wrong_file_is_never_used(tmp_path: Path) -> None:
    wrong = b"x" * len(MODEL_BYTES)
    m = make_manager(
        tmp_path, Starts(), model=None, fetch_fn=FakeOrigin(wrong), model_size=len(wrong)
    )
    m.downloader.start()
    _wait_download(m)
    assert (m.downloader.state.status, m.downloader.state.error) == ("failed", "digest_mismatch")
    assert not m.model_path.exists() and not m.downloader.part.exists()


def test_setup_starts_the_download_and_sees_its_progress(
    settings: Settings, db: Database, tmp_path: Path
) -> None:
    m = make_manager(
        tmp_path,
        Starts(),
        model=None,
        fetch_fn=FakeOrigin(MODEL_BYTES),
        model_size=len(MODEL_BYTES),
    )
    app = create_app(dataclasses.replace(settings, voice_root=tmp_path / "whisper"), db)
    with TestClient(app, client=LOOPBACK, headers={"Authorization": f"Bearer {LAUNCH_TOKEN}"}) as c:
        app.state.voice = m
        assert c.get("/voice/status").json()["model"]["status"] == "missing"
        assert c.post("/voice/model").json()["model"]["status"] in (
            "downloading",
            "verifying",
            "ready",
        )
        _wait_download(m)
        model = c.get("/voice/status").json()["model"]
        assert model == {
            "status": "ready",
            "received_bytes": len(MODEL_BYTES),
            "total_bytes": len(MODEL_BYTES),
            "error": None,
        }
        assert c.post("/voice/model").json()["model"]["status"] == "ready"  # nothing to do


def test_the_engine_is_started_once_after_the_model_download(tmp_path: Path) -> None:
    """So the antivirus scans the new program during setup, not when the mic is first pressed."""
    starts = Starts()
    m = make_manager(
        tmp_path,
        starts,
        model=None,
        fetch_fn=FakeOrigin(MODEL_BYTES),
        model_size=len(MODEL_BYTES),
        idle_unload_s=0.3,
    )

    async def body() -> None:
        await m.startup()
        m.downloader.start()
        for _ in range(200):
            await asyncio.sleep(0.02)
            if starts.started:
                break
        assert starts.started == ["cpu"]
        warmed = starts.made[0]
        for _ in range(200):  # and stopped again soon, since nobody is dictating
            await asyncio.sleep(0.02)
            if not warmed.alive():
                break
        assert not warmed.alive()
        await m.shutdown()

    try:
        asyncio.run(body())
    finally:
        starts.cleanup()


def test_done_cuts_the_silence_after_the_last_word() -> None:
    p = phrases.Phrases()
    assert feed(p, quiet(0.3) + tone(1)) == []
    assert p.add(quiet(0.5)) == []  # Done before the pause is long enough to end the phrase
    last = p.flush()
    assert last is not None
    # lead-in 0.3 s + 1 s of speech + TAIL_S, not the whole 0.5 s of silence
    assert seconds(last) <= 0.3 + 1.0 + phrases.TAIL_S + 0.05


def test_a_fresh_engine_is_primed_in_the_background(tmp_path: Path) -> None:
    starts = Starts()
    m = make_manager(tmp_path, starts, prime=True)

    async def body() -> None:
        FakeWhisper.calls = []
        await m.ensure()
        for _ in range(100):
            await asyncio.sleep(0.01)
            if FakeWhisper.calls:
                break
        assert FakeWhisper.calls == ["transcribe:en"]  # one second of silence, text discarded
        await m.shutdown()

    try:
        asyncio.run(body())
    finally:
        starts.cleanup()
