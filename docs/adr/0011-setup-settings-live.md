# ADR 0011 — Setup and settings: app-owned tables, connected to the UI

**Status:** accepted · **Date:** 2026-11-05

**Context.** Setup and settings kept their state as JSON rows in a generic `preferences` table
(ADR 0010), so their `models.py` files were empty, and the UI still ran on its simulation. These
two apps were the first to connect end to end.

**Decision.**
- **Typed tables owned by the app:** `settings` (apps/settings) and `store_identity`,
  `setup_state` (apps/setup), each a single row (`id = 1`, enforced by a check constraint).
  Migration `0003` copies the old `preferences` rows into them and drops `preferences`; its
  downgrade copies them back.
- **Cross-app reads:** chat and projects need the default model. Apps do not import each other,
  so they read it with one SQL statement in `db/lookups.py`. Values many apps need belong in a
  shared table instead.
- **Update check:** Electron main asks the signed feed (installed app only; dev finds nothing)
  and records the result with `POST /settings/update-check`. It checks at start and daily only
  while the switch in Settings is on.
- **Bridge:** `window.aios.setup.*` and `window.aios.settings.*`, validated with zod in main in both
  directions. The backend's `{"error": code}` reaches the UI as the error message;
  `errorCode()` in the contract reads it back. The restore folder comes from the system dialog
  in main, which also reports whether `recovery.pkg` and `chats.db` are in it.
- **UI:** screens keep reading the zustand store. In the desktop app `bridge/live.ts` loads setup
  state and settings before the first render and writes every backend reply into the store; in a
  plain browser the simulation answers as before.

**Consequences.**
- A fresh desktop install opens setup because the backend says so, not browser storage.
- The recovery key is 9 groups of 4 in the desktop app (Recovery Package v1); the browser
  simulation keeps 8.
- Restore shows no epoch number in the desktop app: epochs belong to the evidence writer.
- Projects, chat, search, evidence and models were connected next (ADR 0012).
