# Backend: FastAPI (`services/backend`) + database (`chats.db`)

`backend.exe` is a local FastAPI server. Only Electron main talks to it, over `127.0.0.1` with
a per-launch token. It owns one database, `chats.db`, encrypted with SQLCipher.

## How the backend runs

```text
Electron main ──stdin {token, api_port}──►  backend.exe (__main__.py)
                                              1. read handshake (token never in argv/env)
                                              2. load the desktop profile, content-free logging
                                              3. back up chats.db, run migrations
                                              4. serve FastAPI on 127.0.0.1
Electron main ◄──stdout  READY {"api_port": N}──┘
Electron main ──HTTP + Authorization: Bearer <token>──►  routes ──► services ──► chats.db
```

- `aios_common.asgi_auth.LoopbackTokenMiddleware` rejects anything that is not loopback or has
  the wrong token.
- Error bodies are a code only (`{"error": "store_locked"}`), never user input.
- Logs never contain message text, prompts, tokens or keys (`aios_common.logging`).

Profiles (`config.py`): `desktop` (shipped, forced by `__main__`), `dev` (`aios-backend serve`,
fixed dev key, `/health` and `/docs` open) and `test` (pytest, temp folder).

## How the database works

```text
route ──Depends(get_session)──► Session ──► SQLAlchemy engine ──► sqlcipher3 ──► chats.db (encrypted file)
                                                     ▲
                              PRAGMA key on every new connection; key from Windows Credential Manager
```

| Piece | File | Role |
| --- | --- | --- |
| Engine | `db/sqlcipher/__init__.py` | The only module that imports `sqlcipher3`. Applies the 256-bit key on each connection |
| Key | `db/session.py` + `aios_common.keystore` | Desktop: key in Credential Manager (`AIOS` / `db-key`), created on first start. If `chats.db` exists without its key, it stays locked (`/health` → `locked`) |
| Sessions | `db/session.py` | `Database` (one per process). Routes get `db: Db` or `session: DbSession`: one session per request, committed on success, rolled back on error |
| Tables | `db/models.py`, `aios_backend/apps/*/models.py` | SQLAlchemy models on the shared `Base` (`db/base.py`) |
| Registry | `db/registry.py` | Imports every models module so Alembic and tests see all tables |
| Migrations | `db/migrations/versions/` | Numbered Alembic files; run at startup after a backup. Never edit an applied one |

Only `chats.db` is declared here. The evidence log (`evidence.db`) belongs to the separate
evidence writer and is never opened by this backend.

## Code layout (`services/backend`)

Two Python packages sit side by side, with no `src/` folder. Both ship in the `aios-backend`
distribution (`pyproject.toml`) and in `backend.exe` (`build/pyinstaller/backend.spec`).

```text
aios_backend/          the API (import as aios_backend.*)
  __main__.py          backend.exe entry: handshake, migrate, serve, READY line
  main.py              App factory: logging, error handlers, routers, token middleware
  config.py            Settings and the three profiles
  cli.py               aios-backend: serve, migrate, makemigrations, check, openapi, sql, …
  routes.py            System routes (/health)
  gateway/             OpenAI-compatible inference gateway (security-relevant path)
  apps/                One package per feature, named like apps/ui/src/features
    setup/             First-run wizard
    workspace/         App shell: projects, counts, status
db/                    chats.db (import as db.*): engine, sessions, base, models, registry, migrations
tests/                 pytest suite (pytest.ini puts this folder on the path)
alembic.ini            Plain `alembic` access to db/migrations
.dev/                  Dev database and log (not committed)
```

`aios_backend` imports `db` for sessions and migrations; `db` imports only
`aios_backend.config` (for `Settings`).

### Apps

Each backend app mirrors its UI feature folder and has the same five modules. They contain only a
docstring today: no endpoints, tables or logic yet, and no router is mounted in `main.py`.

| Module | Holds | May import |
| --- | --- | --- |
| `router.py` | HTTP endpoints. Thin: validate, call the service, return a schema | `service`, `schemas` |
| `schemas.py` | Pydantic request/response bodies, the shape the UI gets through the bridge | — |
| `service.py` | The app's rules | `repository`, `schemas` |
| `repository.py` | Reads and writes `chats.db` through the session | `models` |
| `models.py` | SQLAlchemy tables owned by the app | `db.base` |

| Backend package | UI folder | Will cover |
| --- | --- | --- |
| `apps/setup` | `apps/ui/src/features/setup` | Hardware check, model download/import and verification, store and recovery key, benchmark, first-run state |
| `apps/workspace` | `apps/ui/src/features/workspace` | Projects and classification, conversation and evidence counts, engine and writer status |

**Adding the first endpoint to an app:** write the schema, service and route, then
`app.include_router(...)` in `main.py`. Run `uv run aios-backend openapi` and commit
`contracts/local-api/openapi.json`. Add the call to the bridge contract, desktop IPC, preload and
`apps/ui/src/bridge` in the same pull request.

**Adding a table:** define it in the app's `models.py` (already listed in
`db/registry.py`), then `uv run aios-backend makemigrations -m "..."` and review the file.

## Rules (checked in CI by import-linter, `pyproject.toml`)

- Apps never import each other.
- Inside an app, imports only go down: `router → service → repository → models`.
- Routers (`routes.py`, `apps/*/router.py`) never import sqlalchemy, the DB driver,
  `subprocess`, `httpx` or `socket`.
- Only `db/sqlcipher` imports `sqlcipher3`; only `aios_common.keystore` imports `keyring`.
- `aios_common` never imports `aios_backend` or `db`.

## Commands

| Command (repo root) | What it does |
| --- | --- |
| `pnpm dev:backend` | Dev server on http://127.0.0.1:8765 (`/health`, `/docs`) |
| `pnpm check:py` | ruff, import rules, mypy, tests |
| `uv run aios-backend routes` | List routes |
| `uv run aios-backend migrate` / `check` | Upgrade the dev database / check key, version and migrations |
| `uv run aios-backend makemigrations -m "..."` | Next numbered migration after a model change |
| `pnpm build:backend` | `build/out/backend/backend.exe` (PyInstaller) |
