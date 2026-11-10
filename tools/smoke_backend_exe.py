"""D-01 / AC-10 checks against the built backend.exe, started the way Electron main starts it.

    uv run python tools/smoke_backend_exe.py [build/out/backend/backend.exe]

Windows only (CI package-windows job). Exits non-zero on the first failed check.
"""

import base64
import json
import os
import secrets
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

EXE = Path(sys.argv[1] if len(sys.argv) > 1 else "build/out/backend/backend.exe").resolve()


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")
    if not ok:
        sys.exit(1)


def get(port: int, path: str, token: str | None) -> tuple[int, str]:
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:  # noqa: S310 (loopback only)
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def powershell(command: str) -> str:
    return subprocess.run(
        ["powershell", "-NoProfile", "-Command", command], capture_output=True, text=True
    ).stdout.strip()


def start(data_dir: str, frame: bytes) -> subprocess.Popen[bytes]:
    # Same environment as the packaged Electron app (apps/desktop/src/main/backend/spawn.ts).
    env = {"SystemRoot": os.environ["SystemRoot"], "LOCALAPPDATA": data_dir}
    proc = subprocess.Popen(
        [str(EXE)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env
    )
    assert proc.stdin is not None
    proc.stdin.write(frame)
    proc.stdin.close()
    return proc


def main() -> None:
    token = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
    with tempfile.TemporaryDirectory() as data_dir:
        bad = start(data_dir, b'{"token": "too-short"}\n')
        code = bad.wait(60)
        check(
            "Malformed handshake exits 2, no READY", code == 2 and b"READY" not in bad.stdout.read()
        )  # type: ignore[union-attr]

        proc = start(data_dir, json.dumps({"token": token, "api_port": 0}).encode() + b"\n")
        try:
            assert proc.stdout is not None
            started = time.monotonic()
            line = proc.stdout.readline().decode().strip()
            check(
                "READY line within 30 s",
                line.startswith("READY "),
                f"{line} after {time.monotonic() - started:.1f} s",
            )
            port = int(json.loads(line[6:])["api_port"])

            status, body = get(port, "/health", None)
            check("No token -> 401", status == 401, str(status))
            status, _ = get(port, "/health", "wrong-token")
            check("Wrong token -> 401", status == 401, str(status))
            status, _ = get(port, "/docs", token)
            check("No /docs in the shipped exe", status == 404, str(status))
            status, body = get(port, "/health", token)
            health = json.loads(body) if status == 200 else {}
            check(
                "GET /health reports backend, engine, evidence writer",
                status == 200
                and health.get("backend") == "ok"
                and health.get("engine") == "not_started"
                and health.get("evidence_writer") == "not_started",
                body,
            )

            status, body = get(port, "/models/catalogue", token)
            entries = json.loads(body).get("entries", []) if status == 200 else []
            check(
                "GET /models/catalogue reads the bundled catalogue",
                status == 200 and len(entries) > 0,
                body[:200],
            )

            listen = powershell(
                f"(Get-NetTCPConnection -LocalPort {port} -State Listen).LocalAddress | Sort-Object -Unique"
            )
            check("Listens on 127.0.0.1 only", listen == "127.0.0.1", repr(listen))

            cmd = powershell(
                f"(Get-CimInstance Win32_Process -Filter 'ProcessId={proc.pid}').CommandLine"
            )
            check("Token not in the command line", bool(cmd) and token not in cmd, cmd)
            check(
                "Token not in the environment",
                token not in "".join(os.environ.values()),
                "only SystemRoot and LOCALAPPDATA passed",
            )
        finally:
            proc.terminate()
            proc.wait(30)

        logs = [
            p for p in Path(data_dir).rglob("*") if p.is_file() and p.suffix in {".log", ".txt"}
        ]
        leaked = [p.name for p in logs if token in p.read_text(errors="replace")]
        check("Token not in any log file", not leaked, f"{len(logs)} log files checked")
        assert proc.stderr is not None
        check("Token not in stderr", token.encode() not in proc.stderr.read())


if __name__ == "__main__":
    main()
