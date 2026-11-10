"""D-03: prove the patched llama-server takes its key from stdin (M-19, SR-08)
and runs with the hardened flag set from build/llama/README.md.

Skipped unless two environment variables are set (CI engine jobs set them):

    AIOS_LLAMA_SERVER  path to the built llama-server(.exe), e.g. build/out/llama/cpu/llama-server
    AIOS_TEST_MODEL    path to a small GGUF model (CI uses stories260K.gguf)

The launcher below is the reference for the process manager (D-05): same
flags, same minimal environment, key over stdin. See build/llama/README.md.
"""

from __future__ import annotations

import json
import os
import secrets
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

SERVER = os.environ.get("AIOS_LLAMA_SERVER")
MODEL = os.environ.get("AIOS_TEST_MODEL")

pytestmark = pytest.mark.skipif(
    not (SERVER and MODEL), reason="set AIOS_LLAMA_SERVER and AIOS_TEST_MODEL"
)

HARDENED_FLAGS = [
    "--api-key-stdin",
    "--host",
    "127.0.0.1",
    "--offline",
    "--no-webui",
    "--no-slots",
    "--no-ui-mcp-proxy",
]


def minimal_env(private_dir: Path) -> dict[str, str]:
    """No LLAMA_* variables, and no APPDATA/PROGRAMDATA (Windows) or
    XDG_CONFIG_HOME pointing at a real config (Linux): llama.cpp reads
    options from all of those."""
    server_dir = str(Path(SERVER).parent)
    if sys.platform == "win32":
        root = os.environ["SystemRoot"]
        return {
            "SystemRoot": root,  # Winsock does not initialise without it
            "PATH": f"{server_dir};{root}\\System32",
            "TEMP": str(private_dir),
            "TMP": str(private_dir),
        }
    return {
        "PATH": f"{server_dir}:/usr/bin:/bin",
        "HOME": str(private_dir),
        "XDG_CONFIG_HOME": str(private_dir),
        "XDG_CACHE_HOME": str(private_dir),
        "TMPDIR": str(private_dir),
    }


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _request(url: str, key: str | None = None, body: dict | None = None) -> tuple[int, bytes]:
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


class Engine:
    def __init__(self, proc: subprocess.Popen, port: int, key: str, workdir: Path):
        self.proc, self.port, self.key, self.workdir = proc, port, key, workdir
        self.base = f"http://127.0.0.1:{port}"


@pytest.fixture(scope="module")
def engine(tmp_path_factory):
    workdir = tmp_path_factory.mktemp("engine")
    key = secrets.token_urlsafe(32)
    port = _free_port()
    proc = subprocess.Popen(
        [SERVER, "-m", MODEL, "--port", str(port), "-c", "512", *HARDENED_FLAGS],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        cwd=workdir,
        env=minimal_env(workdir),
    )
    proc.stdin.write(f"{key}\n".encode())
    proc.stdin.close()

    deadline = time.monotonic() + 120
    while True:
        try:
            status, _ = _request(f"http://127.0.0.1:{port}/health")
            if status == 200:
                break
        except OSError:
            pass
        if proc.poll() is not None or time.monotonic() > deadline:
            out = proc.stdout.read().decode(errors="replace")
            pytest.fail(f"llama-server did not become healthy:\n{out[-4000:]}")
        time.sleep(0.25)

    eng = Engine(proc, port, key, workdir)
    yield eng
    proc.terminate()
    proc.wait(timeout=30)


def test_answers_a_prompt_with_the_key(engine):
    status, body = _request(
        f"{engine.base}/v1/chat/completions",
        engine.key,
        {"messages": [{"role": "user", "content": "Once upon a time"}], "max_tokens": 8},
    )
    assert status == 200, body
    assert json.loads(body)["choices"][0]["message"]["content"] is not None


@pytest.mark.parametrize(
    "path, body",
    [
        ("/v1/chat/completions", {"messages": [{"role": "user", "content": "hi"}]}),
        ("/completion", {"prompt": "hi"}),
        ("/v1/models", None),
        ("/props", None),
        ("/tokenize", {"content": "hi"}),
    ],
)
def test_rejects_requests_without_the_key(engine, path, body):
    assert _request(f"{engine.base}{path}", None, body)[0] == 401
    assert _request(f"{engine.base}{path}", "wrong-key", body)[0] == 401


# IPC-34 (approved 2026-11-06): upstream's public routes at the pinned commit are exactly
# these two (get_public_endpoints in tools/server/server-http.cpp). Liveness only.
PUBLIC_ROUTES = ("/health", "/v1/health")
# Everything else needs the key. If a llama.cpp update opens one of these, CI fails and the
# pin change goes back to the reviewer.
KEYED_ROUTES = (
    "/models",
    "/v1/models",
    "/props",
    "/metrics",
    "/api/tags",
    "/v1/embeddings",
    "/detokenize",
    "/infill",
)


@pytest.mark.parametrize("path", PUBLIC_ROUTES)
def test_health_routes_are_public_and_carry_liveness_only(engine, path):
    status, body = _request(f"{engine.base}{path}")
    assert status == 200
    assert set(json.loads(body)) <= {"status", "error"}


@pytest.mark.parametrize("path", KEYED_ROUTES)
def test_health_is_the_only_public_endpoint(engine, path):
    assert _request(f"{engine.base}{path}")[0] == 401


def test_webui_paths_serve_nothing_without_the_key(engine):
    # Upstream also lets the web UI's own paths through without a key; with --no-webui
    # nothing is served there.
    for path in ("/", "/index.html"):
        status, body = _request(f"{engine.base}{path}")
        assert status in (401, 404) and b"<html" not in body.lower()


def test_slots_and_webui_are_off(engine):
    # /slots would expose prompt content; the UI is not built in at all.
    assert _request(f"{engine.base}/slots", engine.key)[0] in (404, 501)
    assert _request(f"{engine.base}/", engine.key)[0] == 404


def test_listens_on_loopback_only(engine):
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            s.connect(("192.0.2.1", 9))
            lan_ip = s.getsockname()[0]
        except OSError:
            pytest.skip("no non-loopback interface")
    if lan_ip.startswith("127."):
        pytest.skip("no non-loopback interface")
    with pytest.raises(OSError):
        socket.create_connection((lan_ip, engine.port), timeout=1).close()


def test_key_not_in_command_line_or_environment(engine):
    if sys.platform == "win32":
        cmd = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                f"(Get-CimInstance Win32_Process -Filter 'ProcessId={engine.proc.pid}').CommandLine",
            ],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        assert cmd.strip(), "could not read the engine command line"
        assert engine.key not in cmd
        # The environment is the minimal_env() dict built above; nothing else is inherited.
        assert engine.key not in "".join(minimal_env(engine.workdir).values())
    else:
        for name in ("cmdline", "environ"):
            assert engine.key.encode() not in Path(f"/proc/{engine.proc.pid}/{name}").read_bytes()


def test_key_not_on_disk(engine):
    # The engine's working directory doubles as its HOME/TEMP: nothing may be written there.
    written = [p for p in engine.workdir.rglob("*") if p.is_file()]
    for path in written:
        assert engine.key.encode() not in path.read_bytes(), f"key found in {path}"


def test_key_not_in_engine_output(engine):
    _request(f"{engine.base}/v1/models", "wrong-key")
    engine.proc.terminate()
    engine.proc.wait(timeout=30)
    output = engine.proc.stdout.read()
    assert engine.key.encode() not in output


def test_refuses_to_start_without_a_key(tmp_path):
    result = subprocess.run(
        [SERVER, "-m", MODEL, "--port", str(_free_port()), *HARDENED_FLAGS],
        input=b"",
        capture_output=True,
        cwd=tmp_path,
        env=minimal_env(tmp_path),
        timeout=60,
    )
    assert result.returncode != 0
    assert b"--api-key-stdin" in result.stdout + result.stderr
