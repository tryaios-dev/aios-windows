# ADR 0010 — Backend data: shared tables, evidence outbox, answer source

**Status:** accepted · **Date:** 2026-11-05

**Context.** The backend apps got their first endpoints (setup, projects, chat, search,
evidence, settings). Three questions came up that the layout in ADR 0009 did not answer:
1. Where do tables live that several apps read? Apps must not import each other, but chat reads
   projects, search reads messages, and projects copies and exports conversations.
2. How does the backend record evidence? Only the evidence writer may open `evidence.db`
   (CLAUDE.md invariant 5), and the writer does not exist yet.
3. How does chat send a message before the local model module (engine, gateway) exists?

**Decision.**
- **Shared tables in `db/models.py`** (`preferences` was replaced in migration 0003, see ADR 0011): `projects`, `conversations`, `provider_moves`,
  `messages`, `summaries`, `evidence_outbox` and `preferences`, in migration `0002`. An app's own
  `models.py` is for tables only that app uses. Small JSON state (settings, store identity,
  first run) goes in `preferences` through `db/preferences.py`, which lists the keys.
- **Evidence outbox:** every app calls `db.outbox.record(...)` in the same transaction as the
  change, so a change and its event are saved together or not at all. Bodies are checked:
  only ids, enum values, digests, counts and flags. Event types follow the Evidence Wire
  Format v1 registry where it has one (`store_created`, `project_created`,
  `inference_completed`, …) and add `project_reclassified`, `project_deleted`,
  `conversation_deleted`, `provider_changed` and `refusal` (allowed: v1 readers accept unknown
  types). The writer will drain the outbox, chain and sign the events and fill `seq`.
- **Answer source:** chat calls an `AnswerSource` protocol (`apps/chat/answers.py`) given to
  `create_app`. It is `None` today, so sending answers `409 no_model` and stores nothing. The
  model module will provide the real one; tests use a fake.
- **Shared crypto helpers:** RFC 8785 canonical JSON and domain-separated hashing are in
  `aios_common.canonical` until `packages/py/aios-wire` exists.
- **Errors:** services raise `aios_backend.errors.AppError(code, status)`; the response is
  `{"error": code}` only.
- `cryptography` became a direct backend dependency (Recovery Package: Argon2id, AES-256-GCM,
  Ed25519). It was already in the lock file.

**Consequences.**
- Every evidence event is pending until the writer runs, and evidence export returns
  `503 writer_unavailable`.
- Sending is not streamed yet: `POST /conversations/{id}/messages` returns the whole answer.
  Streaming over server-sent events, stop and "continue locally" come with the model module.
- Restore replaces `chats.db` under the running backend. It backs up the current file first,
  and puts the file and keys back if any step fails.
- The UI still uses its simulated backend. Each `apps/ui/src/bridge/api.ts` function can now be
  switched to a `window.aios` call (bridge contract, IPC handler, preload) one endpoint at a
  time.
