"""One local answer from the real engine build, the way chat gets it (G-01, G-02).

Replaces the D-04 spike tests: the answer goes through the local model module and the process
manager, not a separate endpoint. Skipped unless AIOS_LLAMA_SERVER and AIOS_TEST_MODEL are set.
"""

from pathlib import Path

import pytest
from tests.conftest import LAUNCH_TOKEN
from tests.engine_support import MODEL_ID, ask, client, local_app, needs_engine

from aios_backend.config import Settings
from db.session import Database

pytestmark = needs_engine


def test_streams_one_local_answer(settings: Settings, db: Database, tmp_path: Path) -> None:
    with client(local_app(settings, db, tmp_path)) as c:
        assert ask(c).strip()
        assert c.get("/health").json()["engine"] == "ok"


@pytest.mark.skipif(not Path("/proc").exists(), reason="process inspection via /proc")
def test_ipc_30_engine_key_not_in_its_command_line_or_environment(
    settings: Settings, db: Database, tmp_path: Path
) -> None:
    with client(local_app(settings, db, tmp_path)) as c:
        ask(c)
        engine = c.app.state.engine._engine  # type: ignore[attr-defined]
        for name in ("cmdline", "environ"):
            data = Path(f"/proc/{engine.process.pid}/{name}").read_bytes()
            assert engine.key.encode() not in data
            assert LAUNCH_TOKEN.encode() not in data
        assert b"LLAMA" not in Path(f"/proc/{engine.process.pid}/environ").read_bytes()


def test_engine_stops_with_the_backend(settings: Settings, db: Database, tmp_path: Path) -> None:
    with client(local_app(settings, db, tmp_path)) as c:
        ask(c)
        proc = c.app.state.engine._engine.process  # type: ignore[attr-defined]
    assert proc.wait(15) is not None


def test_g04_the_loaded_engine_counts_tokens(
    settings: Settings, db: Database, tmp_path: Path
) -> None:
    with client(local_app(settings, db, tmp_path)) as c:
        local = c.app.state.answers  # type: ignore[attr-defined]
        assert local.count_tokens("local", MODEL_ID, "The supplier list") is None  # not loaded
        ask(c)
        short = local.count_tokens("local", MODEL_ID, "The supplier list")
        long = local.count_tokens("local", MODEL_ID, "The supplier list for March. " * 20)
        assert isinstance(short, int) and isinstance(long, int) and 0 < short < long
