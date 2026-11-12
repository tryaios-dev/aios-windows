"""B-03 / AC-23: the backend and the evidence writer build on Ubuntu and start (not shipped).

    uv run python tools/smoke_linux_build.py

Run after PyInstaller has built ``build/out/backend`` and ``build/out/evidence-writer``:

* evidence-writer: started from the built bundle with a handshake (development profile, a
  throw-away folder), it prints READY, answers with the derived token and refuses without it.
* backend: the shipped program runs only on an OS AIOS ships for (Windows), so on Linux it must
  read the handshake and then refuse with the platform error and no READY line. Reaching that
  point proves the bundle imports and starts.
"""

import json
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "build" / "out"
SUFFIX = ".exe" if sys.platform == "win32" else ""
TOKEN = "ab" * 32
failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f": {detail}"))
    if not ok:
        failures.append(name)


def get(port: int, token: str | None) -> int:
    req = urllib.request.Request(f"http://127.0.0.1:{port}/status")  # noqa: S310 - loopback
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:  # noqa: S310
            return int(resp.status)
    except urllib.error.HTTPError as exc:
        return exc.code


def writer() -> None:
    exe = OUT / "evidence-writer" / ("evidence-writer" + SUFFIX)
    check("evidence-writer was built", exe.is_file(), str(exe))
    if not exe.is_file():
        return
    with tempfile.TemporaryDirectory() as data:
        proc = subprocess.Popen(
            [str(exe), "--profile", "dev", "--data-dir", data],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        assert proc.stdin is not None and proc.stdout is not None
        proc.stdin.write(json.dumps({"token": TOKEN}).encode() + b"\n")
        proc.stdin.close()
        line = proc.stdout.readline().decode()
        try:
            check("evidence-writer prints READY", line.startswith("READY "), line)
            if line.startswith("READY "):
                port = int(json.loads(line[6:])["api_port"])
                check("evidence-writer answers its token", get(port, TOKEN) == 200)
                check("evidence-writer refuses without it", get(port, None) == 401)
        finally:
            proc.kill()
            proc.wait(10)


def backend() -> None:
    exe = OUT / "backend" / ("backend" + SUFFIX)
    check("backend was built", exe.is_file(), str(exe))
    if not exe.is_file() or sys.platform == "win32":
        return  # Windows runs the full smoke test instead (tools/smoke_backend_exe.py)
    proc = subprocess.run(
        [str(exe)],
        input=json.dumps({"token": "A" * 43}).encode() + b"\n",
        capture_output=True,
        timeout=60,
        check=False,
    )
    check("backend starts and refuses an OS it does not ship for", proc.returncode != 0)
    check("backend prints no READY line there", b"READY" not in proc.stdout)
    check(
        "backend names the platform refusal",
        b"UnsupportedPlatform" in proc.stderr or b"Windows only" in proc.stderr,
        proc.stderr[-300:].decode("utf-8", "replace"),
    )


if __name__ == "__main__":
    writer()
    backend()
    sys.exit(1 if failures else 0)
