# Invariants (MVP spec Section 5.3) — never violate

1. The UI never calls a model. The renderer (`apps/ui`) has no `fetch`, Node built-ins or
   `electron`; its only door is `window.aios`. Every model request goes through
   `apps/providers` → `apps/gateway` in the backend.
2. No silent Local → Company transfer. Moving history to the company server always asks.
3. Secrets live only in the OS keystore and the wrapped Recovery Package — never in files,
   logs, evidence, settings or environment variables.
4. The per-launch token is generated in Electron main and sent over stdin. Never argv, env,
   logs or files. Only Electron main and the backend ever hold it.
5. Only `services/evidence-writer` opens `evidence.db`. The backend settings declare exactly
   one database (`chats.db`).
6. Logs contain no content: no message text, prompts, tokens, keys or recovery material.
7. Frozen contracts (`contracts/*/v1/FROZEN`) only gain optional fields; semantics never change.
8. `apps/verifier-cli` shares no code with anything else in the repo. It reads only `contracts/`.

# Boundaries (enforced in CI)

Python (import-linter, `pyproject.toml`):
- `aios_common` never imports `aios_backend`
- `sqlcipher3` only in `db/sqlcipher`; `keyring` only in `aios_common.keystore`
- `aios_backend.routes` (and future route modules) stay thin: no sqlalchemy, DB driver,
  subprocess or raw network; they take `session: DbSession` / `db: Db`

TypeScript (eslint, `packages/ts/config`):
- `apps/ui`: no fetch / XMLHttpRequest / WebSocket / Node / electron / eval
- `apps/desktop/src/preload`: exposes exactly `@aios/bridge-contract`

# Working rules

- Tests first (MVP 14.4): every AC-xx is a failing test before the feature (`test_ac_XX_*` in
  Python, `ac-XX` in the test name in TypeScript).
- Backend: `services/backend/src/aios_backend/` = `__main__.py` (backend.exe), `main.py` (app
  factory), `config.py`, `cli.py`, `routes.py`, and `db/` (chats.db on SQLCipher). A new feature
  gets its own router module and is included in `main.py`. Keep routes thin.
- Schema changes only through numbered Alembic migrations (`aios-backend makemigrations`);
  never edit an applied migration. New model modules are imported in `db/registry.py`.
- The SQLCipher build is pinned in `services/backend/pyproject.toml` and `build/sqlcipher/pin.json`;
  change both together.
- A backend API change, the regenerated `contracts/local-api/openapi.json`
  (`uv run aios-backend openapi`) and the UI change land in the same pull request.
- Every IPC handler in `apps/desktop/src/main/ipc/` zod-validates before calling the backend.
- One UI feature = one folder in `apps/ui/src/features/`.
- New dependency = lock file updated in the same PR (`uv lock`, `pnpm install`); CI installs
  with `--frozen` and fails otherwise.
- Security-relevant paths (see `.github/CODEOWNERS`) need the technical reviewer.
