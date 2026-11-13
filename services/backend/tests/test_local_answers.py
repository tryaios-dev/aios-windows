"""G-02 / AC-04 / AC-07: chat answers come from the local engine, with thinking text removed."""

import asyncio
import json
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from aios_backend.components import Components
from aios_backend.engine import EngineManager
from aios_backend.engine.client import ThinkFilter, benchmark, stream_chat
from aios_backend.engine.launcher import Engine
from aios_backend.local import SYSTEM_PROMPT, LocalModels

PIECES = ["<thi", "nk>planning the answer</th", "ink>Hello", " there", "!"]


class FakeEngine(BaseHTTPRequestHandler):
    """llama-server's streaming chat API, as far as the backend uses it."""

    requests: list[dict[str, object]] = []

    def do_POST(self) -> None:  # noqa: N802
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        FakeEngine.requests.append({"auth": self.headers["Authorization"], **body})
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        events = [{"choices": [{"delta": {"reasoning_content": "hidden"}}]}]
        events += [{"choices": [{"delta": {"content": p}}]} for p in PIECES]
        events.append({"choices": [{"delta": {}}], "timings": {"predicted_per_second": 14.5}})
        for e in events:
            self.wfile.write(f"data: {json.dumps(e)}\n\n".encode())
        self.wfile.write(b"data: [DONE]\n\n")

    def log_message(self, *args: object) -> None:
        pass


class FakeProcess:
    returncode = None

    def poll(self) -> None:
        return None

    def terminate(self) -> None:
        pass

    def wait(self, timeout: float | None = None) -> int:
        return 0


@pytest.fixture
def engine_port() -> Iterator[int]:
    FakeEngine.requests = []
    server = ThreadingHTTPServer(("127.0.0.1", 0), FakeEngine)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield server.server_address[1]
    server.shutdown()


def fake_engine(port: int, model: Path) -> Engine:
    return Engine(FakeProcess(), port, "engine-key", model)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("chunks", "expected"),
    [
        (["Hello"], "Hello"),
        (["<think>x</think>Hi"], "Hi"),
        (["<thi", "nk>abc</thi", "nk>Hi"], "Hi"),
        (["Hi <", "b>"], "Hi <b>"),  # a "<" that is not a think tag is kept
        (["<think>never closed"], ""),
    ],
)
def test_ac_07_thinking_text_is_never_part_of_the_answer(chunks: list[str], expected: str) -> None:
    f = ThinkFilter()
    assert "".join(f.feed(c) for c in chunks) + f.flush() == expected


def test_ac_04_answers_stream_from_the_engine(engine_port: int, tmp_path: Path) -> None:
    text = "".join(
        stream_chat(
            fake_engine(engine_port, tmp_path / "m.gguf"), [{"role": "user", "content": "Hi"}]
        )
    )
    assert text == "Hello there!"
    sent = FakeEngine.requests[0]
    assert sent["auth"] == "Bearer engine-key"
    assert sent["stream"] is True
    assert sent["chat_template_kwargs"] == {"enable_thinking": False}


def test_benchmark_reads_the_engine_speed(engine_port: int, tmp_path: Path) -> None:
    run = benchmark(fake_engine(engine_port, tmp_path / "m.gguf"))
    assert run.tokens_per_second == 14.5 and run.time_to_first_token_ms >= 0


def test_g_02_local_models_answer_with_the_installed_model(
    engine_port: int, tmp_path: Path, settings: object, client: object
) -> None:
    """Through the process manager on its event loop, called from a worker thread like chat."""
    from fastapi.testclient import TestClient

    from aios_backend.apps.models.models import InstalledModel
    from db.base import utcnow

    assert isinstance(client, TestClient)
    db = client.app.state.db  # type: ignore[attr-defined]
    model_file = tmp_path / "tiny.gguf"
    model_file.write_bytes(b"GGUF")
    with db.session() as session:
        session.add(
            InstalledModel(
                id="tiny",
                name="Tiny",
                tier="small",
                file_path=str(model_file),
                artifact_digest="0" * 64,
                size_bytes=4,
                context_length=32768,
                licence="Apache-2.0",
                source="download",
                installed_at=utcnow(),
            )
        )
        session.commit()

    started: list[Path] = []

    def start(root: Path, model: Path, temp: Path, job: object, build: str) -> Engine:
        started.append(model)
        return fake_engine(engine_port, model)

    components = Components()
    manager = EngineManager(
        tmp_path / "llama",
        tmp_path / "models",
        tmp_path / "tmp",
        components,
        start_fn=start,
        probe_fn=lambda *_: [],
    )
    local = LocalModels(db, manager, components)

    async def run() -> str:
        local.bind(asyncio.get_running_loop())
        info = local.model("local", None)
        assert info is not None and info.model_id == "tiny"
        assert info.context_length == 16384  # what the engine is started with
        assert local.model("company", None) is None
        messages = [{"role": "user", "content": "Hi"}]
        return await asyncio.to_thread(lambda: "".join(local.answer("local", "tiny", messages)))

    assert asyncio.run(run()) == "Hello there!"
    assert started == [model_file]
    # Every local conversation starts with the AIOS system message (small models otherwise
    # answer every later message with their self-introduction).
    sent = FakeEngine.requests[-1]["messages"]
    assert sent[0] == {"role": "system", "content": SYSTEM_PROMPT}
    assert sent[1:] == [{"role": "user", "content": "Hi"}]
    assert local.state().state == "ready"
