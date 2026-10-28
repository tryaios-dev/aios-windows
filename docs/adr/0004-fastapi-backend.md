# ADR 0004 — FastAPI, SQLAlchemy and Alembic for both Python executables

**Status:** accepted · **Date:** 2026-10-26 · **Supersedes:** ADR 0002

**Context.** The Master and MVP specifications name FastAPI for the backend. The scaffold used
Django + Django Ninja (ADR 0002), but the product uses none of Django's strengths (admin, auth,
sessions, templates) and the main workload — streaming answers from llama-server through an
OpenAI-compatible gateway — is async. Django also needed a custom SQLCipher backend and caused
three PyInstaller packaging problems in week 1.

**Decision.**
- backend.exe and evidence-writer.exe are FastAPI apps served by uvicorn, as the spec says.
- Data access is SQLAlchemy 2.0 (typed `Mapped[]` models). chats.db stays SQLCipher; the engine
  in `db/sqlcipher` is the only importer of `sqlcipher3`.
- Schema changes are numbered Alembic migrations (`0001_...`, `0002_...`), run automatically
  at start-up after a backup (M-18) and from the `aios-backend` / `aios-evidence-writer` CLIs.
- The backend serves two separate FastAPI apps: the local API and the gateway, each on its own
  loopback port with its own token. This replaces Django's port-routing middleware.
- Loopback + bearer-token checking is one shared ASGI middleware in `aios_common.asgi_auth`.
- Each backend app is a folder with `router.py`, `schemas.py`, `service.py` and `models.py`.

**Consequences.**
- Matches the specification; no spec change needed.
- `manage.py` is replaced by `uv run aios-backend ...` and `uv run aios-evidence-writer ...`.
- The process contract with Electron (stdin handshake, READY line) is unchanged.
- Evidence append-only is enforced twice, as before: an ORM guard and database triggers.
