# `aios-common`

Small Python package shared by the backend (and later the evidence writer). It holds the
security plumbing every process needs, so each piece is written once and checked in one place.
It never imports `aios_backend` or `db` (import-linter).

## Modules (`src/aios_common`)

| Module | What it does | Rule it serves |
| --- | --- | --- |
| `handshake.py` | Reads the launch handshake from stdin (`{"token", "api_port"}`), then closes stdin. Keeps the token in memory only. `check_bearer()` compares tokens in constant time; `derive(purpose)` makes a separate token for a child process | Token never in argv, env, logs or files (SR-08) |
| `asgi_auth.py` | `LoopbackTokenMiddleware`: rejects any client that is not `127.0.0.1`/`::1` (403) or has no valid bearer token (401). Runs before routing, so callers learn nothing about which paths exist. `public_paths` skips the token check for `/health` and `/docs` in the dev profile only | Only Electron main can call the backend |
| `keystore.py` | `get_secret` / `set_secret` / `delete_secret` in Windows Credential Manager under service `AIOS`. The only module that imports `keyring` | Secrets only in the OS keystore |
| `logging.py` | `ContentFreeFormatter` writes JSON lines with whitelisted keys only (IDs, durations, status, error codes). Anything else is dropped, so message text or keys cannot reach a log | Logs contain no content (SR-07) |
| `paths.py` | Per-user data locations: `%LOCALAPPDATA%\AIOS\data\chats.db`, `recovery.pkg`, `models\`, `logs\`, `backups\`; `ensure_dirs()` creates them on first start | One place for the installed layout |

## Using it

```python
from aios_common.handshake import read_handshake
from aios_common.asgi_auth import LoopbackTokenMiddleware
from aios_common.keystore import get_secret
from aios_common.logging import get_logger, log_event

log = get_logger("api")
log_event(log, "request_done", status=200, duration_ms=12)  # only allowed keys are written
```

To log a new kind of field, add its key to `ALLOWED_KEYS` in `logging.py`. Never add a key that
can carry message text, prompts, tokens or keys.

## Tests and checks

`tests/` holds its pytest suite (run by `uv run python tools/run_tests.py`). `handshake.py`,
`asgi_auth.py` and `keystore.py` are security-relevant paths (`.github/CODEOWNERS`).
