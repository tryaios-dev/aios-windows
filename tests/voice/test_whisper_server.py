"""ADR 0016: prove the patched whisper-server takes its key from stdin (M-19, SR-08), requires
it on every route, and offers nothing but transcription and liveness.

Skipped unless three environment variables are set (CI voice engine jobs set them):

    AIOS_WHISPER_SERVER  path to the built whisper-server(.exe), e.g. build/out/whisper/cpu/whisper-server
    AIOS_WHISPER_MODEL   path to a Whisper ggml model (CI: base q5_1)
    AIOS_WHISPER_SAMPLE  a 16 kHz mono WAV of speech (CI: samples/jfk.wav from the pinned source)

Same launch as the engine (tests/engine/test_engine.py): key over stdin, loopback, minimal
environment. See build/whisper/README.md.
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

SERVER = os.environ.get("AIOS_WHISPER_SERVER")
MODEL = os.environ.get("AIOS_WHISPER_MODEL")
SAMPLE = os.environ.get("AIOS_WHISPER_SAMPLE")

pytestmark = pytest.mark.skipif(
    not (SERVER and MODEL and SAMPLE),
    reason="set AIOS_WHISPER_SERVER, AIOS_WHISPER_MODEL and AIOS_WHISPER_SAMPLE",
)

HARDENED_FLAGS = ["--api-key-stdin", "--host", "127.0.0.1"]
# What the sample says (jfk.wav), lower case, without punctuation.
SAMPLE_WORDS = "ask not what your country can do for you"


def minimal_env(private_dir: Path) -> dict[str, str]:
    """No WHISPER_* or GGML_* variables (whisper-server reads WHISPER_ARG_DEVICE)."""
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


def _multipart(fields: dict[str, bytes]) -> tuple[bytes, str]:
    boundary = secrets.token_hex(16)
    parts = []
    for name, value in fields.items():
        filename = '; filename="audio.wav"' if name == "file" else ""
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"{filename}\r\n\r\n'.encode()
            + value
            + b"\r\n"
        )
    body = b"".join(parts) + f"--{boundary}--\r\n".encode()
    return body, f"multipart/form-data; boundary={boundary}"


def _request(
    url: str,
    key: str | None = None,
    fields: dict[str, bytes] | None = None,
    method: str | None = None,
) -> tuple[int, bytes, dict[str, str]]:
    headers = {}
    data = None
    if fields is not None:
        data, headers["Content-Type"] = _multipart(fields)
    if key:
        headers["Authorization"] = f"Bearer {key}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.status, resp.read(), dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers)


def _audio() -> dict[str, bytes]:
    return {"file": Path(SAMPLE).read_bytes(), "response_format": b"json"}


class Whisper:
    def __init__(self, proc: subprocess.Popen, port: int, key: str, workdir: Path):
        self.proc, self.port, self.key, self.workdir = proc, port, key, workdir
        self.base = f"http://127.0.0.1:{port}"


@pytest.fixture(scope="module")
def whisper(tmp_path_factory):
    workdir = tmp_path_factory.mktemp("whisper")
    key = secrets.token_urlsafe(32)
    port = _free_port()
    proc = subprocess.Popen(
        [SERVER, "-m", MODEL, "--port", str(port), *HARDENED_FLAGS],
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
            if _request(f"http://127.0.0.1:{port}/health", key)[0] == 200:
                break
        except OSError:
            pass
        if proc.poll() is not None or time.monotonic() > deadline:
            out = proc.stdout.read().decode(errors="replace")
            pytest.fail(f"whisper-server did not become healthy:\n{out[-4000:]}")
        time.sleep(0.25)

    w = Whisper(proc, port, key, workdir)
    yield w
    if proc.poll() is None:
        proc.terminate()
        proc.wait(timeout=30)


def _words(text: str) -> str:
    return " ".join("".join(c for c in text.lower() if c.isalnum() or c.isspace()).split())


def test_transcribes_with_the_key(whisper):
    status, body, _ = _request(f"{whisper.base}/inference", whisper.key, _audio())
    assert status == 200, body
    assert SAMPLE_WORDS in _words(json.loads(body)["text"])


@pytest.mark.parametrize(
    "path, method",
    [("/inference", "POST"), ("/health", "GET"), ("/inference", "OPTIONS")],
)
def test_every_route_rejects_a_missing_or_wrong_key(whisper, path, method):
    # No upload: the key is checked before the body is read, and Windows resets a connection
    # that is closed with unread upload data, which would hide the 401. The upload with the key
    # is covered by test_transcribes_with_the_key.
    for key in (None, "wrong-key", whisper.key[:-1]):
        status, _, _ = _request(f"{whisper.base}{path}", key, None, method)
        assert status == 401, (path, method, key is None)


def test_health_carries_liveness_only(whisper):
    status, body, _ = _request(f"{whisper.base}/health", whisper.key)
    assert status == 200
    assert set(json.loads(body)) == {"status"}


@pytest.mark.parametrize("path", ["/", "/index.html", "/load"])
def test_load_page_and_static_files_are_gone(whisper, path):
    # Upstream's POST /load loaded any model path it was given; GET / served an HTML page and
    # static files from --public.
    for method, fields in (("GET", None), ("POST", {"model": MODEL.encode()})):
        status, body, _ = _request(f"{whisper.base}{path}", whisper.key, fields, method)
        assert status == 404, (method, path)
        assert b"<html" not in body.lower()


def test_no_cors_headers(whisper):
    _, _, headers = _request(f"{whisper.base}/health", whisper.key)
    assert not [h for h in headers if h.lower().startswith("access-control-")]


def test_listens_on_loopback_only(whisper):
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        try:
            s.connect(("192.0.2.1", 9))
            lan_ip = s.getsockname()[0]
        except OSError:
            pytest.skip("no non-loopback interface")
    if lan_ip.startswith("127."):
        pytest.skip("no non-loopback interface")
    with pytest.raises(OSError):
        socket.create_connection((lan_ip, whisper.port), timeout=1).close()


def test_key_not_in_command_line_or_environment(whisper):
    if sys.platform == "win32":
        cmd = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                f"(Get-CimInstance Win32_Process -Filter 'ProcessId={whisper.proc.pid}').CommandLine",
            ],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        assert cmd.strip(), "could not read the whisper-server command line"
        assert whisper.key not in cmd
        assert whisper.key not in "".join(minimal_env(whisper.workdir).values())
    else:
        for name in ("cmdline", "environ"):
            assert whisper.key.encode() not in Path(f"/proc/{whisper.proc.pid}/{name}").read_bytes()


def test_nothing_written_to_disk(whisper):
    # The working directory doubles as HOME/TEMP: no key, no audio, no text may land there.
    _request(f"{whisper.base}/inference", whisper.key, _audio())
    assert [p for p in whisper.workdir.rglob("*") if p.is_file()] == []


def test_neither_key_nor_text_in_output(whisper):
    # SR-07: the server output carries no content. It is checked last: it stops the server.
    _request(f"{whisper.base}/inference", whisper.key, _audio())
    _request(f"{whisper.base}/health", "wrong-key")
    whisper.proc.terminate()
    whisper.proc.wait(timeout=30)
    output = whisper.proc.stdout.read()
    assert whisper.key.encode() not in output
    assert SAMPLE_WORDS not in _words(output.decode(errors="replace"))


@pytest.mark.parametrize(
    "stdin, flags", [(b"", HARDENED_FLAGS), (b"key\n", ["--host", "127.0.0.1"])]
)
def test_refuses_to_start_without_a_key(tmp_path, stdin, flags):
    result = subprocess.run(
        [SERVER, "-m", MODEL, "--port", str(_free_port()), *flags],
        input=stdin,
        capture_output=True,
        cwd=tmp_path,
        env=minimal_env(tmp_path),
        timeout=60,
    )
    assert result.returncode != 0
    assert b"--api-key-stdin" in result.stdout + result.stderr
