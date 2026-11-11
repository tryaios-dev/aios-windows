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
  cli.py               aios-backend: serve, serve-e2e, migrate, makemigrations, check, openapi, sql, …
  routes.py            System routes (/health)
  errors.py            AppError: what services raise; main.py returns {"error": code}
  deps.py              Shared FastAPI dependencies (AppSettings)
  gateway/             OpenAI-compatible inference gateway (security-relevant path)
  apps/                One package per feature, named like apps/ui/src/features
    chat/              Conversations and messages
    evidence/          Evidence log as the app shows it
    models/            Model manager and catalogue
    projects/          Projects, classification, packages
    search/            Search across projects
    settings/          Settings and the network allowlist
    setup/             First run (store, recovery key) and restore
db/                    chats.db (import as db.*): engine, sessions, base, models, registry, migrations
  models.py            The shared tables (projects, conversations, messages, summaries, outbox)
  outbox.py            record(): queue a content-free evidence event in the caller's transaction
  lookups.py           One-value reads/writes of another app's table in plain SQL (default model)
tests/                 pytest suite (pytest.ini puts this folder on the path)
alembic.ini            Plain `alembic` access to db/migrations
.dev/                  Dev database and log (not committed)
```

`aios_backend` imports `db` for sessions and migrations; `db` imports only
`aios_backend.config` (for `Settings`).

### Apps

Each backend app mirrors its UI feature folder and has the same five modules. An app may add
helper modules with pure logic (no HTTP, no database), such as `projects/package.py`.

| Module | Holds | May import |
| --- | --- | --- |
| `router.py` | HTTP endpoints. Thin: validate, call the service, return a schema | `service`, `schemas` |
| `schemas.py` | Pydantic request/response bodies, the shape the UI gets through the bridge | — |
| `service.py` | The app's rules; raises `AppError("code", status)` | `repository`, `schemas` |
| `repository.py` | Reads and writes `chats.db` through the session | `models`, `db.*` |
| `models.py` | Tables only this app uses (setup: `store_identity`, `setup_state`; settings: `settings`; models: `installed_models`, `hardware_profile`). Shared tables are in `db/models.py` | `db.base` |

All seven apps have endpoints. Not in this build: download from the model mirror, the local
engine (llama-server, benchmark, the real chat answer source) and the evidence writer.

| Backend app | Endpoints | Notes |
| --- | --- | --- |
| `apps/setup` | `GET /setup/status`, `POST /setup/store`, `POST /setup/complete`, `POST /restore` | Store creation writes `recovery.pkg` (Recovery Package v1, `recovery_package.py`) and returns the recovery key once. Restore unwraps the package, checks the backup belongs to it, then swaps `chats.db` and the keys, all or nothing. State in `store_identity` and `setup_state` |
| `apps/projects` | `GET/POST /projects`, `GET/PATCH/DELETE /projects/{id}`, `POST /projects/{id}/reclassify`, `PUT /projects/{id}/company-ai`, `POST /projects/{id}/export`, `POST /projects/import` | Lowering a class makes a reviewed copy (M-04). Project Package v1 in `package.py`, with every ZIP and checksum rule of the contract |
| `apps/chat` | `GET/POST /projects/{id}/conversations`, `PATCH/DELETE /conversations/{id}`, `POST /conversations/{id}/provider`, `GET/POST /conversations/{id}/messages`, `POST /conversations/{id}/regenerate`, `GET /providers/status` | Answers come from an `AnswerSource` (`answers.py`). None exists yet, so sending returns `409 no_model`; tests use a fake. Commitments per Evidence Wire Format v1 §8 |
| `apps/search` | `GET /search?q=` | Substring match over messages, newest first, at most 60 hits |
| `apps/evidence` | `GET /evidence`, `GET /projects/{id}/evidence`, `GET /evidence/status`, `POST /evidence/export` | Lists the outbox. Until the evidence writer exists, events stay pending and export returns `503 writer_unavailable` |
| `apps/settings` | `GET/PATCH /settings`, `POST /settings/update-check`, `GET /system/network` | One typed row in `settings`. Electron main's updater records each check result. A test keeps the allowlist equal to `contracts/network-allowlist/v1` |
| `apps/models` | `GET /models/catalogue`, `GET /models`, `POST /models/import`, `POST /models/download/{entry_id}`, `DELETE /models/{id}`, `GET /system/hardware`, `GET /engine/status` | Catalogue from `catalogue_dev.json` (unsigned until I-01; equal to the UI's, a test checks). Entries are real published files (MiniCPM5 2B small, Ornith 1.5 9B medium) with real size and SHA-256. Import installs a .gguf only if size and SHA-256 match an entry and a third-party entry's review passed (`deviation_not_approved` otherwise), then copies it into the models folder. Hardware read from Windows (`hardware.py`). Download answers `503 mirror_unavailable` |

Full list: `uv run aios-backend routes`. Request and response shapes:
`contracts/local-api/openapi.json`.

### Evidence from the backend

The backend never opens `evidence.db`. Every change the log covers calls
`db.outbox.record(session, "type", body=...)` inside the same transaction, so the change and its
event are saved together or not at all. The body may only hold ids, enum values, digests,
counts and flags: a string with spaces or over 128 characters is refused. The evidence writer
will drain the outbox, chain and sign the events, and set `seq`; until then events are pending.

### Keys

| Key | Where it lives |
| --- | --- |
| Database key | Credential Manager `AIOS` / `db-key` (desktop); fixed in dev/test |
| Evidence signing seed | Credential Manager `AIOS` / `evidence-signing-seed` (desktop); fixed in dev/test |
| Recovery key | Nowhere. Returned once by `POST /setup/store`; it wraps the two keys above in `recovery.pkg` |

**Adding an endpoint:** write the schema, service and route (for a new app, also
`app.include_router(...)` in `main.py`). Run `uv run aios-backend openapi` and commit
`contracts/local-api/openapi.json`. Add the call to the bridge contract, desktop IPC, preload and
`apps/ui/src/bridge/api.ts` in the same pull request.

**Adding a table:** shared tables go in `db/models.py`, tables only one app uses in that app's
`models.py` (listed in `db/registry.py`). Then `uv run aios-backend makemigrations -m "..."` and
review the file.

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
| `pnpm check:py` | ruff, import rules, mypy, OpenAPI file, tests |
| `uv run aios-backend routes` | List routes |
| `uv run aios-backend migrate` / `check` | Upgrade the dev database / check key, version and migrations |
| `uv run aios-backend makemigrations -m "..."` | Next numbered migration after a model change |
| `pnpm build:backend` | `build/out/backend/backend.exe` (PyInstaller) |
