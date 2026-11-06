# ADR 0009 — Backend layout: no `src/`, a top-level `db` package, apps named after UI features

**Status:** accepted · **Date:** 2026-10-30

**Context.** The backend used the `src/` layout (`services/backend/src/aios_backend/...`) with the
database code inside the API package (`aios_backend.db`). Paths were long, and the database layer,
which is security-relevant and owns `chats.db`, was not visibly separate from the API. The UI had
gained one folder per feature (ADR 0008) with no matching structure on the backend.

**Decision.**
- No `src/` folder. `services/backend/` holds two packages side by side:
  - `aios_backend/`: the FastAPI app (`__main__.py`, `main.py`, `config.py`, `cli.py`,
    `routes.py`, `gateway/`, `apps/`).
  - `db/`: `chats.db` on SQLCipher (engine, sessions, base, models, registry, migrations),
    imported as `db.*`.
- Both ship in the `aios-backend` distribution (`pyproject.toml`) and in `backend.exe`
  (`build/pyinstaller/backend.spec`).
- `aios_backend/apps/<name>/` is one package per UI feature, with the same name as its folder in
  `apps/ui/src/features/`. Each has `router.py`, `schemas.py`, `service.py`, `repository.py` and
  `models.py`. The first two were `setup` and `workspace`, layout only (see the update below).
- Import rules (import-linter, root `pyproject.toml`):
  - apps never import each other;
  - inside an app, imports only go down: router → service → repository → models;
  - routers never import sqlalchemy, the DB driver, `subprocess`, `httpx` or `socket`;
  - only `db.sqlcipher` imports `sqlcipher3`; `aios_common` never imports `aios_backend` or `db`.

**Consequences.**
- `db` depends on `aios_backend.config` (for `Settings`), and `aios_backend` depends on `db`. There
  is no import cycle at module level; keep it that way.
- `db` is a generic top-level name. It is safe while nothing else installed is called `db`; check
  before adding a dependency that ships one.
- The applied migration `0001_initial_schema.py` changed one import line
  (`aios_backend.db.base` → `db.base`) so it can still load. Its schema is unchanged. This is the
  only allowed kind of edit to an applied migration.
- Ruff's exclude list names `apps/desktop` and `apps/ui` explicitly, so the backend `apps/`
  package is still linted.
- The Developer Brief and Backend Commands documents, CODEOWNERS, CI and the contract specs'
  owner paths were updated to the new paths.

**Update (2026-11-05): one backend app per UI feature.**
The UI now has seven features (ADR 0008 update), so `aios_backend/apps/` has seven layout-only
packages with the same names: `chat`, `evidence`, `models`, `projects`, `search`, `settings` and
`setup`. `workspace` was removed: the UI shell moved to `apps/ui/src/app/`, and what it was meant to
cover belongs to `projects` (projects and counts) and the system routes (`/health`). The import
rules and `db/registry.py` list all seven. `evidence` only talks to the evidence writer; it never
opens the evidence database (CLAUDE.md invariant 5).

Six of the seven apps have endpoints since 2026-11-05; see [ADR 0010](0010-backend-data.md).
