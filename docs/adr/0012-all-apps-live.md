# ADR 0012 — All apps connected, models app data, end-to-end test

**Status:** accepted · **Date:** 2026-11-05

**Context.** After ADR 0011 only setup and settings ran on the backend. Projects, chat, search
and evidence had endpoints but the UI still used its simulation, and the models app had no
tables or endpoints. Nothing tested the UI, preload, main and backend together.

**Decision.**
- **Models app:** tables `installed_models` and `hardware_profile` (migration `0004`). The
  catalogue is read from `catalogue_dev.json` (Model Catalogue v1 shape, unsigned, the same entries
  as the UI; a test keeps them equal) until the signed catalogue exists (I-01). Offline import
  installs a .gguf only if its size and SHA-256 equal an entry, then copies it into the models
  folder (`Settings.models_dir`). Hardware is read from Windows (registry, Win32) and kept.
  Download answers `503 mirror_unavailable`: the mirror host is still a placeholder.
- **Deleting the default model** clears it in Settings through `db.lookups.clear_default_model`
  (apps do not import each other).
- **Bridge:** `projects`, `conversations`, `search`, `evidence` and `models` groups, validated with
  zod in main. File dialogs (package export and import, model import) run in main; the renderer
  only gets the chosen path.
- **UI:** in the desktop app `api.ts` sends every change to the backend and `live.ts` reloads
  what it touched into the store. Out-of-order reloads are dropped (a ticket per list).
- **End-to-end test** (`pnpm test:e2e`, CI job `e2e`): the UI's `api.ts`, the real preload and main
  handlers, and a real backend from `aios-backend serve-e2e` (test profile, throw-away folder,
  token over stdin). Only Electron is replaced. `--echo` gives that backend a test-only answer
  source; `backend.exe` never has one.

**Consequences.**
- Chat in the desktop app says "No local model is ready" until the engine exists.
- Evidence events stay pending and evidence export is refused until the evidence writer exists.
- The browser simulation stays for layout work and must keep matching the backend's shapes.
