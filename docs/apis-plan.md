# Local API plan: endpoints the UI needs

Status: **built in the backend, 2026-11-06** (branch `apis`). Every 🆕 and ✏️ endpoint below now
exists in `services/backend` and in `contracts/local-api/openapi.json` (62 operations). The marks
below still show what was new or changed in this round. The bridge, IPC handlers and screens are
not wired to the new endpoints yet (see "Implementation notes" at the end).

This document lists every backend endpoint the desktop UI (`apps/ui`) needs, module by module.
It was made by walking every screen, button, menu item, link, icon button and switch in
`apps/ui/src` and following each one to the call it makes in `apps/ui/src/bridge/api.ts`.

Legend:

| Mark | Meaning |
| --- | --- |
| ✅ | Exists in `services/backend` and in `contracts/local-api/openapi.json` today |
| 🆕 | New endpoint to build |
| ✏️ | Exists, but needs a change (new optional fields or parameters only) |
| P1 / P2 / P3 | Priority. P1: the screen is simulated or refused in the desktop app without it. P2: works today, but slowly or with missing data. P3: nice to have |

---

## 1. How a UI action reaches the backend

```
Screen (button) → api.ts → window.aios (bridge-contract) → Electron main ipc/ (zod check) → backend HTTP
```

- The UI has no `fetch`. Its only door is `window.aios` (CLAUDE.md invariant 1).
- Electron main adds the per-launch token and calls the backend on loopback.
- System dialogs (open file, choose folder, save as) run in Electron main. The backend only ever
  receives the chosen path.

### Conventions every endpoint follows

| Rule | Value |
| --- | --- |
| Base URL | `http://127.0.0.1:<port>` (loopback only, chosen by Electron main) |
| Auth | Per-launch token checked by `LoopbackTokenMiddleware`; only `/health` is public |
| Body format | JSON. Times are ISO 8601 / RFC 3339 UTC strings |
| Ids in paths | `^[A-Za-z0-9._-]{1,64}$` (checked by `Id` in bridge-contract) |
| Errors | `{"error": "<code>"}` with an HTTP status. Never echo user input. The UI maps each code to plain text in `bridge/live.ts` (`MESSAGES`) |
| Validation error | `422 {"error": "invalid_request"}` |
| Locked store | `503 {"error": "store_locked"}` |
| Evidence | A change worth recording queues an event with `db.outbox.record` in the same transaction |
| Logs | Content-free: no message text, prompts, keys or recovery material |

### Definition of done for each new or changed endpoint

1. Router, schema, service, repository in `services/backend/aios_backend/apps/<feature>/` (routes stay thin).
2. Alembic migration if a table changes (`aios-backend makemigrations`).
3. Tests first: `test_ac_XX_*` where an acceptance criterion applies.
4. Shape added to `packages/ts/bridge-contract/src/index.ts` and the `AiosBridge` interface.
5. Zod-validated handler in `apps/desktop/src/main/ipc/`.
6. `apps/ui/src/bridge/api.ts` calls the bridge in live mode instead of the simulated store.
7. Error codes added to `MESSAGES` in `apps/ui/src/bridge/live.ts`.
8. `uv run aios-backend openapi` regenerated, all in the same pull request.

---

## 2. Summary

| # | Module (backend app) | Screens | ✅ Existing | 🆕 New | ✏️ Change |
| --- | --- | --- | --- | --- | --- |
| 3 | System and health (`routes.py`, new `apps/system`) | Sidebar status, Settings › Health, About, Data | 1 | 3 | 0 |
| 4 | Setup and restore (`apps/setup`) | Setup wizard, Restore screen | 4 | 0 | 1 |
| 5 | Projects (`apps/projects`) | Sidebar, project header menu, Project settings, package dialogs | 9 | 0 | 1 |
| 6 | Chat (`apps/chat`) | Conversation list, chat pane, composer, chat dialogs | 9 | 5 | 1 |
| 7 | Search (`apps/search`) | Ctrl K palette, Search page | 1 | 0 | 1 |
| 8 | Evidence (`apps/evidence`) | Evidence tab, event sheet, export dialog, Data | 4 | 3 | 2 |
| 9 | Models, engine, hardware (`apps/models`) | Models page, setup steps, Settings › Engine/Hardware | 7 | 9 | 3 |
| 10 | Settings and network (`apps/settings`) | Settings › General, Network | 4 | 0 | 0 |
| | **Total** | | **39** | **20** | **9** |

All CRUD for projects, conversations and installed models already exists. What is missing is
mostly: streaming and stopping answers, model downloads, the local engine, the benchmark,
evidence export and chain details, and a few status endpoints.

### What blocks some new endpoints

Several endpoints can only be finished when a component that is not in this build exists. Until
then they return the error shown, and the UI already explains it to the user.

| Component | Not built yet | Endpoints waiting for it | Error until then |
| --- | --- | --- | --- |
| Local engine (llama-server) | yes | answer streaming, stop, continue locally, benchmark, engine start | `409 no_model` / `503 engine_unavailable` |
| Evidence writer (`services/evidence-writer`) | yes | evidence export, checkpoints, chain hashes, restore epoch | `503 writer_unavailable` |
| Model mirror | yes | downloads, catalogue check | `503 mirror_unavailable` |

---

## 3. System and health

Screens: sidebar footer (engine and evidence-writer dots, both open Settings › Health), Settings ›
Health ("Components" list, "Create support bundle"), Settings › About, Settings › Data.

| UI element | Endpoint | Status | Priority |
| --- | --- | --- | --- |
| Health poll every 10 s (`useHealth`) | `GET /health` | ✅ | — |
| Sidebar engine dot, writer dot; Health › Components (Backend, Local engine, Evidence writer, Company AI) | `GET /system/status` | 🆕 | P1 |
| Health › "Create support bundle" button | `POST /system/support-bundle` | 🆕 | P1 |
| About (version, build, licences), Data › "Where your data lives" paths | `GET /system/info` | 🆕 | P3 |

### ✅ `GET /health`
Backend and database are up. Public (no token), so Electron main can wait for start-up.
Response: `{ backend: "ok", database: "ok" | "locked" | "error", version }`.

### 🆕 `GET /system/status`
One call for everything the status dots and Health page show. Today the UI builds this from four
calls (`/models`, `/providers/status`, `/evidence/status`, `/health`) and guesses the engine state.

Response:
```json
{
  "backend": "ok",
  "database": "ok",
  "version": "0.9.4",
  "engine": { "state": "ready", "build": "vulkan", "loaded_model_id": "qwen3-8b-q4km" },
  "writer": { "state": "unavailable", "pending": 3 },
  "company": { "enabled": false, "reachable": false, "base_url": null, "model_name": null }
}
```
`engine.state` is one of `not_started | no_model | loading | ready | generating | idle_unloaded | failed`
(the UI's `EngineState`). Never contains the company API key.

### 🆕 `POST /system/support-bundle`
Zips the log folder, and nothing else, into one file (support request L-03). Electron main chooses
the destination (Documents by default) and sends the path.

Request: `{ "path": "<folder or file path chosen by main>" }`
Response `201`: `{ file_name, path, size_bytes, file_count, created_at }`
Errors: `400 invalid_path`, `404 log_folder_missing`.
Rules: never includes `chats.db`, `evidence.db`, keys or the Recovery Package. Logs are already
content-free.

### 🆕 `GET /system/info` (P3)
Static build facts for About and Data, so they stop being hard-coded in the UI.
Response: `{ app_version, build_channel, schema_version, data_paths: { root, chats_db, evidence_db, models, logs, backups }, licences: [{ name, role, licence }] }`.
Paths come from `aios_common/platforms/` (platform rule in CLAUDE.md).

---

## 4. Setup and restore

Screens: Setup wizard (Welcome → Machine → Secure → Model → Verified → Engine), Restore screen
(from Welcome "Restore from a backup" and Settings › Data "Restore from a backup").

| UI element | Endpoint | Status | Priority |
| --- | --- | --- | --- |
| App start, first-run guard (`RequireFirstRun`) | `GET /setup/status` | ✅ | — |
| Secure step: store preparation, recovery key shown once, "Request key" retry | `POST /setup/store` | ✅ | — |
| Engine step: "Open AIOS" (finish) | `POST /setup/complete` | ✅ | — |
| Restore screen: "Restore" button and "Restore over the current installation?" confirm | `POST /restore` | ✅ ✏️ | P2 |
| Restore screen: "Choose folder" | Electron main dialog (`setup.chooseBackupFolder`) | no API | — |
| Machine step, Model step, Engine step | see section 9 | | |

### ✅ `GET /setup/status`
Whether first run is done and the encrypted store exists.
Response: `{ first_run_complete, store_created, stream_id, signing_key_id, package_id, default_project_id, completed_at, last_restore_at, recovery_package_present }`.

### ✅ `POST /setup/store`
Creates the store: database key in the OS keystore, signing key, recovery key and `recovery.pkg`.
Response `201`: `{ recovery_key, package_id, stream_id, signing_key_id }`. The recovery key is in
this reply exactly once; nothing keeps it.
Errors: `409 store_exists`.

### ✅ `POST /setup/complete`
Finishes first run and creates the default project.
Response: `{ default_project_id }`. Errors: `409 store_not_created`.

### ✅ ✏️ `POST /restore`
Restores a backup folder with its recovery key, all or nothing.
Request: `{ backup_path, recovery_key }`. Response: `{ stream_id }`.
Errors: `no_recovery_package`, `no_backup_database`, `r_checksum`, `r_unwrap`, `r_mismatch`,
`r_format`, `r_kdf_params`, `r_payload`, `restore_failed`.

Change (optional fields only):
- Request: `confirmed: boolean`. Required as `true` when first run is already complete, so a restore
  over a live installation always passes the confirm dialog. Otherwise `400 confirmation_required`.
- Response: `epoch: number | null`. The new evidence epoch, once the evidence writer numbers epochs.
  The success screen shows it.

---

## 5. Projects

Screens: sidebar "Projects" list, "New project" (+) icon, "Archived" toggle; project header
(classification chip, "New conversation", "Project actions" menu: Rename, Change classification,
Export, Import, Archive / Unarchive with Undo toast, Delete); Project settings tab (Name + Save,
Classification "Change", "Use Company AI…" switch, Project Package Export / Import, Archive, Delete).

| UI element | Endpoint | Status | Priority |
| --- | --- | --- | --- |
| Sidebar project list, archived list, home redirect | `GET /projects` | ✅ ✏️ | P3 |
| Project page header | `GET /projects/{id}` | ✅ | — |
| "New project" dialog → Create | `POST /projects` | ✅ | — |
| Rename (menu, settings "Save"), Archive, Unarchive, "Undo" toast | `PATCH /projects/{id}` | ✅ | — |
| Delete project dialog → Delete | `DELETE /projects/{id}` | ✅ | — |
| Classification chip, "Change classification" dialog | `POST /projects/{id}/reclassify` | ✅ | — |
| "Use Company AI for new conversations" switch and confirm dialog | `PUT /projects/{id}/company-ai` | ✅ | — |
| "Export project" dialog → Export (after main's save dialog) | `POST /projects/{id}/export` | ✅ | — |
| "Import a package" dialog → choose file (main dialog) → Import | `POST /projects/import` | ✅ | — |
| "Open original project" link on a reviewed copy | client navigation | no API | — |

### ✅ `GET /projects`
All projects, newest first. Response: `Project[]` with `{ id, name, classification, classification_source, derived_from_project_id, company_ai_enabled, archived, created_at, updated_at }`.
✏️ P3: optional query `archived=true|false` to filter. The UI filters itself today.

### ✅ `GET /projects/{id}`
One project. Errors: `404 project_not_found`.

### ✅ `POST /projects`
Request: `{ name (1–200), classification: "restricted" | "internal" | "public" }`. Response `201`: `Project`.
Evidence: `project_created`.

### ✅ `PATCH /projects/{id}`
Rename or archive. Request: `{ name?, archived? }`. Response: `Project`.

### ✅ `DELETE /projects/{id}`
Deletes the project with its conversations and messages. Response `204`. Evidence: `project_deleted`.

### ✅ `POST /projects/{id}/reclassify`
Request: `{ to }`. Raising changes the project in place. Lowering never rewrites records: it creates
a reviewed copy that points back at the original (M-04).
Response: `{ project, reviewed_copy: boolean }`. Evidence: `project_reclassified`.

### ✅ `PUT /projects/{id}/company-ai`
Request: `{ enabled, confirmed }`. Turning it on needs `confirmed: true` (no silent Local → Company,
invariant 2). Errors: `400 confirmation_required`, `409 company_provider_disabled`.

### ✅ `POST /projects/{id}/export`
Writes a Project Package v1 (`.aiosproj`). Electron main shows the save dialog and passes the path.
Request: `{ path, confirmed }`. Response: `{ file_name, path, size_bytes, checksum, package_id, evidence_seq }`.
Evidence: `project_exported`.

### ✅ `POST /projects/import`
Imports a package, all or nothing, after every checksum passes.
Request: `{ path }`. Response `201`: `{ project_id, project_name, conversations, messages, summaries, warnings, remapped }`.
Errors: `p_zip`, `p_format`, `p_checksum`, `p_reference`, `p_unlisted`, `p_missing`, `file_not_readable`.
Evidence: `project_imported`.

---

## 6. Chat (conversations and messages)

Screens: conversation list ("New conversation" +, empty-state "Start a conversation", row click,
row "Actions" menu: Rename, Archive / Unarchive, Delete; "Archived" toggle); chat pane ("Back",
"Rename conversation" icon, "No model installed → Go to Models", per answer: "Copy answer",
"Regenerate answer", "Continue locally", evidence seq link "Open in timeline"); composer (message
box, "Send", "Stop", model menu + "Manage models", "Where this conversation runs" menu: Move to
Local / Move to Company); dialogs ("Move this conversation to Company AI?", "Continue this
conversation locally?", "Which model should continue this conversation?").

| UI element | Endpoint | Status | Priority |
| --- | --- | --- | --- |
| Conversation list (per project, also sidebar and search titles) | `GET /projects/{id}/conversations` | ✅ | — |
| "New conversation" (header, list +, empty state, Ctrl K) | `POST /projects/{id}/conversations` | ✅ | — |
| Refresh one conversation after rename, archive, model or provider change | `GET /conversations/{id}` | 🆕 | P2 |
| Rename, Archive / Unarchive, composer model picker | `PATCH /conversations/{id}` | ✅ | — |
| Delete conversation dialog | `DELETE /conversations/{id}` | ✅ | — |
| "Move to Local", "Move to Company" + confirm dialog | `POST /conversations/{id}/provider` | ✅ | — |
| Opening a conversation | `GET /conversations/{id}/messages` | ✅ | — |
| "Send" (no streaming) | `POST /conversations/{id}/messages` | ✅ | — |
| "Send" with live words, "Loading engine…", "Preparing context…" | `POST /conversations/{id}/messages/stream` | 🆕 | P1 |
| "Stop" | `POST /conversations/{id}/stop` | 🆕 | P1 |
| "Generating" dot in the list, Stop button after a reload | `GET /conversations/{id}/generation` | 🆕 | P2 |
| "Regenerate answer" | `POST /conversations/{id}/regenerate` | ✅ | — |
| "Continue locally" (interrupted Company answer, or Company unreachable on send) | `POST /conversations/{id}/continue-locally` | 🆕 | P1 |
| Composer provider menu (Company reachable?), Network › Company AI server | `GET /providers/status` | ✅ ✏️ | P1 |
| "Which model should continue…?" dialog (model was deleted) | `PATCH /conversations/{id}` (`model_id`) then send again | ✅ | — |
| "Copy answer", "Copy code" | clipboard | no API | — |

### ✅ `GET /projects/{project_id}/conversations`
Newest first. Response: `Conversation[]` with `{ id, project_id, title, classification_effective, classification_source, provider_mode, current_provider, model_id, archived, created_at, updated_at, last_message_preview, moves: [{ to, at }] }`.

### ✅ `POST /projects/{project_id}/conversations`
Request: `{ title? }`. Uses Company if the project has Company AI on, otherwise the default model.
Response `201`: `Conversation`. Evidence: `conversation_created`.

### 🆕 `GET /conversations/{id}`
One conversation. Today the UI reloads every conversation of the project after each small change.
Response: `Conversation`. Errors: `404 conversation_not_found`.

### ✅ `PATCH /conversations/{id}`
Request: `{ title?, archived?, model_id? }`. Response: `Conversation`.
Errors: `404 model_not_found` when `model_id` is not installed.

### ✅ `DELETE /conversations/{id}`
Deletes the conversation and its messages. Response `204`. Evidence: `conversation_deleted`.

### ✅ `POST /conversations/{id}/provider`
Request: `{ to: "local" | "company", confirmed }`. Moving to Company needs `confirmed: true`; moving
to Local never asks (M-09). Response: `Conversation` (a new entry in `moves`).
Errors: `400 confirmation_required`, `409 company_provider_disabled`. Evidence: `provider_changed`, `disclosure_confirmed`.

### ✅ `GET /conversations/{id}/messages`
Messages in order. Response: `Message[]` with `{ id, role, content, status, provider, model_id, prompt_tokens, completion_tokens, created_at, evidence_pending, evidence_seq, previous_versions, continued_from, … }`.

### ✅ `POST /conversations/{id}/messages`
Sends a message and waits for the whole answer. Request: `{ text }`. Response: `{ user, assistant }`.
Errors: `422 empty_message`, `413 message_too_large` (also records a `refusal` event), `409 no_model`,
`409 model_missing`, `409 company_unreachable`, `409 busy`. Evidence: `inference_completed`.

### 🆕 `POST /conversations/{id}/messages/stream`
Same as send, but the answer arrives word by word. The response is `text/event-stream`. Electron
main reads the stream and forwards each event to the renderer over IPC (the renderer cannot open
a connection itself). The bridge gains an event subscription, for example
`conversations.onStream(listener)`.

Request: `{ text }`. Events:

| Event | Data | UI effect |
| --- | --- | --- |
| `started` | `{ user: Message, assistant_id }` | user message shown, empty answer bubble |
| `phase` | `{ phase: "loading_engine" \| "preparing" \| "streaming" }` | "Loading engine…", "Preparing context…" |
| `delta` | `{ text }` | words appended |
| `done` | `{ assistant: Message }` | final message with tokens and evidence seq |
| `error` | `{ error: "<code>", assistant?: Message }` | partial answer kept with status `partial` or `error` |

Errors before the stream starts are the same as `POST /messages`. Only one generation at a time
(`409 busy`).

### 🆕 `POST /conversations/{id}/stop`
Stops the answer being generated. The words so far are saved with status `stopped`.
Response: `Message` (the stopped answer). Errors: `409 not_generating`.

### 🆕 `GET /conversations/{id}/generation`
Whether this conversation is answering right now.
Response: `{ generating: boolean, message_id, phase, provider }`. Lets the list dot and the Stop
button survive a window reload. (It could also be one field in `GET /system/status`.)

### ✅ `POST /conversations/{id}/regenerate`
Answers the last question again. The old answer is kept in `previous_versions` (assumption A-03).
Response: `{ user: null, assistant }`. Errors: `409 nothing_to_regenerate`, plus the send errors.
A streamed variant (`/regenerate/stream`, same events) should be added together with the stream endpoint.

### 🆕 `POST /conversations/{id}/continue-locally`
Moves a Company conversation to Local and answers there (M-09). Two cases from the UI:
- an interrupted Company answer: `{ partial_message_id }`. A new local answer is created with `continued_from` pointing at the partial one.
- Company unreachable while sending: `{ text }`. The pending message is sent locally.

Response: `{ conversation, user | null, assistant }`. No confirmation needed (moving to Local never asks).
Errors: `404 message_not_found`, `409 not_partial`, `409 no_model`, `409 model_missing`.
Evidence: `provider_changed`, `continuation`.

### ✅ ✏️ `GET /providers/status`
Response today: `{ local_ready, company_enabled }`.
Change: add `company: { reachable, base_url, model_name, checked_at }` (null when Company is off).
The composer greys out "Move to Company" when it is not reachable, and Settings › Network › Company
AI server shows the base URL and model. Never includes the API key (invariant 3).

---

## 7. Search

Screens: Ctrl K command palette (search box, results, "New conversation in …" action) and the Search
page (search box, "Clear search", Project filter, Type filter, "Include archived" switch, "Clear
filters", result click opens the conversation).

| UI element | Endpoint | Status | Priority |
| --- | --- | --- | --- |
| Palette and Search page results (debounced) | `GET /search?q=` | ✅ ✏️ | P3 |
| Filters, result click, palette navigation | client side | no API | — |

### ✅ ✏️ `GET /search`
Messages containing the query, newest first. Query: `q` (max 200).
Response: `SearchHit[]` with `{ message_id, conversation_id, project_id, snippet, created_at, role }`.
Change (P3, optional parameters): `project_id`, `role=user|assistant`, `include_archived` (default
true), `limit` (default 60, max 200). The Search page filters on the client today, which hides
results beyond the first 60.

---

## 8. Evidence

Screens: project Evidence tab (timeline, event-type filter chips, "Clear filters", "Export
evidence" buttons, deep-link notice with "Dismiss"), event detail sheet (Identity, Commitments,
Chain, Payload, "Open conversation"), "Export evidence" dialog (scope: this project or date range,
destination, "Export", verifier command "Copy"), evidence summary (custody, latest checkpoint),
Settings › Data (current epoch, evidence stream), Settings › Health (writer status, pending count).

| UI element | Endpoint | Status | Priority |
| --- | --- | --- | --- |
| Timeline (all events) | `GET /evidence` | ✅ ✏️ | P2 |
| Timeline for one project | `GET /projects/{id}/evidence` | ✅ | — |
| Writer dot, "N pending" | `GET /evidence/status` | ✅ | — |
| "Export evidence" dialog → Export | `POST /evidence/export` | ✅ ✏️ | P1 |
| Event detail sheet, `?seq=` deep link, "Open in timeline" link on answers and exports | `GET /evidence/{seq}` | 🆕 | P2 |
| Evidence summary custody, Data › current epoch and stream | `GET /evidence/stream` | 🆕 | P1 |
| Checkpoint markers in the timeline, latest checkpoint, export dialog checkpoint count | `GET /evidence/checkpoints` | 🆕 | P1 |
| Event-type filter chips | client side (✏️ server filter optional) | — | P3 |

### ✅ ✏️ `GET /evidence`
Recorded events, oldest first. Query: `project_id?`.
Response: `EvidenceEvent[]` with `{ id, event_id, event_type, actor, ts, project_id, conversation_id, payload, seq, pending }`.

Changes (optional fields and parameters only):
- Response fields from Evidence Wire Format v1, null while the event is still pending:
  `format_version, stream_id, epoch, provider, model_digest, input_commitment, output_commitment, prev_hash, event_hash`.
  The detail sheet shows them; today the UI fills zero hashes.
- Query (P3): `event_type` (repeatable), `from`, `to`, `after_seq`, `limit` for paging long logs.

### ✅ `GET /projects/{project_id}/evidence`
Same as `GET /evidence?project_id=`.

### ✅ `GET /evidence/status`
Response: `{ writer: "ok" | "unavailable", pending }`.

### 🆕 `GET /evidence/{seq}`
One event with every chain field. Used by the detail sheet and by `?seq=` links.
Errors: `404 event_not_found`.

### ✅ ✏️ `POST /evidence/export`
Today it takes no body and always answers `503 writer_unavailable`.
Change: a signed, content-free bundle of events, checkpoints and signer keys, written by the
evidence writer (only it opens `evidence.db`, invariant 5). Electron main shows the save dialog.

Request:
```json
{ "scope": "project", "project_id": "p_123", "path": "<chosen by main>", "confirmed": true }
{ "scope": "range", "from": "2026-11-01T00:00:00Z", "to": "2026-11-06T23:59:59Z", "path": "…", "confirmed": true }
```
Response `201`: `{ file_name, path, size_bytes, stream_id, epoch_range: [a, b], first_seq, last_seq, expected_tip, signer_key_ids, checkpoint_ids, custody, exported_at, scope }`.
Errors: `503 writer_unavailable`, `400 invalid_range`, `404 project_not_found`, `409 nothing_to_export`, `400 invalid_path`.
Evidence: `export` (kind `evidence`).

### 🆕 `GET /evidence/stream`
The identity of this installation's evidence stream.
Response: `{ stream_id, device_id, epoch, signer_key_id, prior_tip_hash, created_at }`.
Part of it is in `/setup/status` today; epoch and prior tip are not.

### 🆕 `GET /evidence/checkpoints`
Signed checkpoints. Query: `from_seq?`, `to_seq?`.
Response: `Checkpoint[]` with `{ id, stream_id, epoch, seq_from, seq_to, root_hash, signer_key_id, signature, created_at }`.
Empty list until the evidence writer exists.

---

## 9. Models, engine and hardware

Screens: Models page ("This machine" card with "Run benchmark", catalogue cards with Download,
Import, Pause, Resume, Cancel, Retry, Delete; "Default for new conversations" picker; empty
catalogue "Go to General"), Delete model dialog, setup Machine step (hardware checks, model size
choice), Model step (download from mirror or import file, Pause / Resume / Retry, "Skip"), Verified
step (digest and provenance checks), Engine step ("Start the engine", benchmark result), Settings ›
Engine (Safe mode switch, engine state, default model, "Manage models"), Settings › Hardware
("Run a benchmark"), GPU-to-CPU fallback notice ("Use Safe mode", "Dismiss").

| UI element | Endpoint | Status | Priority |
| --- | --- | --- | --- |
| Catalogue cards, setup Model step | `GET /models/catalogue` | ✅ | — |
| Installed state on cards, Engine › Installed models, default picker | `GET /models` | ✅ | — |
| Verified step, model card details | `GET /models/{id}` | 🆕 | P3 |
| "Import" / "Import a file" (after main's file dialog) | `POST /models/import` | ✅ | — |
| Delete model dialog → Delete | `DELETE /models/{id}` | ✅ | — |
| "Download" | `POST /models/downloads` (was `POST /models/download/{entry_id}`) | ✏️ | P1 |
| Progress bar: received, speed, remaining, Verifying | `GET /models/downloads` | 🆕 | P1 |
| "Pause" | `POST /models/downloads/{entry_id}/pause` | 🆕 | P1 |
| "Resume", "Retry" after an interrupted download | `POST /models/downloads/{entry_id}/resume` | 🆕 | P1 |
| "Cancel" | `DELETE /models/downloads/{entry_id}` | 🆕 | P1 |
| General › "Check now" (catalogue part), catalogue check at start | `POST /models/catalogue/check` | 🆕 | P1 |
| "This machine" card, Machine step, Settings › Hardware | `GET /system/hardware?refresh=` | ✅ ✏️ | P1 |
| "Run benchmark" (Models, Hardware), Engine step result | `POST /system/benchmark` | 🆕 | P1 |
| Engine state in sidebar, Settings › Engine, Engine step | `GET /engine/status` | ✅ ✏️ | P1 |
| Engine step "Start the engine" | `POST /engine/start` | 🆕 | P1 |
| Fallback notice "Dismiss" and "Use Safe mode" | `POST /engine/fallback/acknowledge` | 🆕 | P3 |
| Default model picker (Models, Settings › Engine) | `PATCH /settings` (`default_model_id`) | ✅ | — |
| Safe mode switch | `PATCH /settings` (`safe_mode_cpu`) | ✅ | — |

### ✅ `GET /models/catalogue`
Models AIOS may install (Model Catalogue v1). Response: `{ version, signed, entries: CatalogueEntry[] }`.

### ✅ `GET /models`
Installed models. Response: `InstalledModel[]` with `{ id, catalogue_entry_id, name, file_path, artifact_digest, size_bytes, context_length, licence, tier, installed_at, source }`.

### 🆕 `GET /models/{id}` (P3)
One installed model plus its provenance checks for the Verified step:
`{ ...InstalledModel, checks: { digest_matches: bool, provenance_complete: bool, pipeline, deviation_approval } }`.
Errors: `404 model_not_found`.

### ✅ `POST /models/import`
Installs a `.gguf` only if it matches a catalogue entry byte for byte (size and SHA-256).
Request: `{ path, entry_id | null }`. Response `201`: `InstalledModel`.
Errors: `not_gguf`, `size_mismatch`, `digest_mismatch`, `model_installed`, `catalogue_entry_not_found`, `file_not_readable`.
Evidence: `model_installed`.

### ✅ `DELETE /models/{id}`
Deletes the model and its file. Clears the default model if it was this one. Response `204`.
Evidence: `model_deleted`.

### Downloads
A download is a resource keyed by catalogue `entry_id`. The UI polls `GET /models/downloads` about
once a second while any download is active.

`DownloadState`: `{ entry_id, status: "queued" | "downloading" | "paused" | "verifying" | "failed" | "done", received_bytes, total_bytes, speed_bps, error, started_at }`.

#### ✏️ `POST /models/downloads`
Starts a download from the model mirror (an allowlisted host). Request: `{ entry_id }`.
Response `202`: `DownloadState`. When the file arrives it is verified like an import and installed.
Errors: `503 mirror_unavailable`, `404 catalogue_entry_not_found`, `409 model_installed`, `409 download_exists`, `507 not_enough_disk`.
Evidence: `model_installed` when done.
Keep `POST /models/download/{entry_id}` as an alias until the UI and IPC move over, then remove it.

#### 🆕 `GET /models/downloads`
All current and recently finished downloads. Response: `DownloadState[]`.

#### 🆕 `POST /models/downloads/{entry_id}/pause`
Response: `DownloadState` with `paused`. Errors: `404 download_not_found`, `409 not_downloading`.

#### 🆕 `POST /models/downloads/{entry_id}/resume`
Resumes from where it stopped (HTTP range). Also used by "Retry" after a failure.
Response: `DownloadState`. Errors: `404 download_not_found`, `503 mirror_unavailable`.

#### 🆕 `DELETE /models/downloads/{entry_id}`
Cancels and deletes the partial file. Response `204`.

### 🆕 `POST /models/catalogue/check`
Fetches the signed catalogue from the mirror, checks the signature and stores it. Updates
`settings.last_catalogue_check` and `settings.catalogue_version`.
Response: `{ version, changed: boolean, checked_at }`.
Errors: `409 catalogue_check_off`, `503 catalogue_unreachable`, `422 catalogue_signature_invalid`.
Settings › General "Check now" calls this together with the update check.

### ✅ ✏️ `GET /system/hardware`
This machine and the recommended tier. Query: `refresh=true` to measure again.
Response: `{ cpu, cores, ram_gb, gpu: { name, vram_gb, driver_ok } | null, free_disk_gb, os, recommended_tier, checked_at }`.
Change: add `benchmark: Benchmark | null`, the latest result, so the cards show it after a restart.

### 🆕 `POST /system/benchmark`
Runs a short benchmark on the local engine.
Request: `{ model_id? }` (default model when omitted).
Response: `Benchmark` = `{ model_id, engine: "cpu" | "vulkan", tokens_per_second, time_to_first_token_ms, run_at }`.
Errors: `409 no_model`, `503 engine_unavailable`, `409 busy` (an answer is being generated).

### ✅ ✏️ `GET /engine/status`
Response today: `{ state: "not_built" | "no_model", installed }`.
Change: `{ state, build: "cpu" | "vulkan", loaded_model_id, installed, fallback: { occurred_at, from_build, to_build, acknowledged } | null }`,
with `state` as in `GET /system/status`.

### 🆕 `POST /engine/start`
Starts the engine and loads a model. Used by the setup Engine step and by the first send when the
engine is idle. Request: `{ model_id? }`. Response: `EngineStatus`.
Errors: `409 no_model`, `404 model_not_found`, `503 engine_unavailable`, `500 engine_failed`.
Respects Safe mode (CPU build only).

### 🆕 `POST /engine/fallback/acknowledge` (P3)
Hides the "GPU build stopped responding" notice for this fallback. Response `204`.
"Use Safe mode" also sends `PATCH /settings { safe_mode_cpu: true }`.
If the notice should not survive a restart, this can stay UI state instead.

---

## 10. Settings and network

Screens: Settings › General ("Check for updates" switch, "Check the model catalogue" switch, "Check
now", "Install update", version), Settings › Network (allowed destinations table, schedule, "Change
the checks in General", Company AI server), Settings › Engine (section 9), Settings › Data (section
3 and 8).

| UI element | Endpoint | Status | Priority |
| --- | --- | --- | --- |
| Every settings screen | `GET /settings` | ✅ | — |
| Update and catalogue switches, Safe mode, default model | `PATCH /settings` | ✅ | — |
| "Check now" (update part), daily check at start | `POST /settings/update-check` (sent by Electron main's updater) | ✅ | — |
| "Install update" | Electron main (`electron-updater` quit and install) | no API | — |
| Allowed destinations table | `GET /system/network` | ✅ | — |
| Company AI server (base URL, model, reachable) | `GET /providers/status` ✏️ (section 6) | | P1 |

### ✅ `GET /settings`
Response: `{ update_check, catalogue_check, safe_mode_cpu, default_model_id, last_update_check, last_catalogue_check, update_available: { version, size_bytes } | null, app_version, catalogue_version, schema_version }`.

### ✅ `PATCH /settings`
Request: any of `{ update_check, catalogue_check, safe_mode_cpu, default_model_id }`; omitted fields
stay. Response: `Settings`. Errors: `invalid_setting`, `model_not_found`.

### ✅ `POST /settings/update-check`
Electron main checks the signed update feed and records the result here.
Request: `{ update_available: { version, size_bytes } | null }`. Response: `Settings`.
Errors: `409 update_check_off`.

### ✅ `GET /system/network`
Every host AIOS may connect to. Response: `AllowlistEntry[]` with `{ id, host, port, purpose, kind: "fixed" | "configured", enabled }`.

---

## 11. Actions that need no backend API

| UI element | Handled by |
| --- | --- |
| AIOS logo / wordmark click ("Go to your last project") | client navigation to `/` |
| Sidebar links (Models, Settings), tabs (Conversations, Evidence, Project settings), settings section nav | client navigation |
| Collapse / expand sidebar, mobile "Open navigation" | UI state |
| Search icon, Ctrl K | opens palette (UI state) |
| Copy answer, copy code, copy recovery key, copy verifier command, copy path | clipboard |
| "Archived" toggles in sidebar and conversation list | UI filter |
| Evidence filter chips, Search page filters | UI filter (server filters optional, P3) |
| Toasts and their "Undo" / "Open" actions | UI; Undo calls the matching existing endpoint |
| Recovery key acknowledgement checkbox, classification "I understand" checkbox | UI state |
| System dialogs: choose package, choose model file, choose backup folder, save as | Electron main |
| "Install update" | Electron main |
| Help and "Pilot support" link | client navigation |

---

## 12. Suggested build order

1. **No blockers, small:** `GET /conversations/{id}`, `GET /system/status`, `POST /system/support-bundle`,
   `GET /evidence/stream`, `GET /evidence/{seq}`, `GET /providers/status` change, `POST /restore`
   change (`confirmed`).
2. **Downloads and catalogue** (with the model mirror): downloads resource, `POST /models/catalogue/check`.
3. **Local engine:** `GET /engine/status` change, `POST /engine/start`, `POST /system/benchmark`,
   streaming send and regenerate, `POST /stop`, `GET /generation`, `POST /continue-locally`.
4. **Evidence writer:** event chain fields, `GET /evidence/checkpoints`, `POST /evidence/export`, restore `epoch`.
5. **P3 polish:** `GET /system/info`, `GET /models/{id}`, search and evidence filters, project list
   filter, fallback acknowledge.

## 13. Open questions

1. Streaming: Server-Sent Events from the backend, forwarded by Electron main over IPC. Is that the
   agreed shape in Process and IPC v1, or should main poll `GET /generation` instead?
2. Download progress: poll `GET /models/downloads` every second, or push from main?
3. Support bundle destination: always Documents, or a save dialog in Electron main?
4. Should the GPU fallback notice persist across restarts (needs `POST /engine/fallback/acknowledge`)
   or stay UI state?
5. Should the old `POST /models/download/{entry_id}` path be kept as an alias, or changed in one
   pull request together with the UI and IPC?

---

## 14. Implementation notes (what was built and how it differs from the plan)

Decisions taken for the open questions in section 13:

1. Streaming uses Server-Sent Events (`text/event-stream`). Electron main still has to read them
   and forward them over IPC.
2. Download progress is polled with `GET /models/downloads` (or `GET /models/downloads/{entry_id}`).
3. Support bundle: the request carries a folder (a file name is chosen) or a `.zip` path.
4. The fallback notice is acknowledged through `POST /engine/fallback/acknowledge`.
5. `POST /models/download/{entry_id}` is kept as a deprecated alias of `POST /models/downloads`.

### Seams: built now, live once the component exists

`create_app(settings, db, answers, engine, mirror)` takes three optional components. All three are
`None` in the shipped build, so the endpoints that need them answer the documented error. Tests
plug in fakes and cover the full behaviour.

| Seam | File | Without it |
| --- | --- | --- |
| `answers` (providers → gateway → engine) | `apps/chat/answers.py` | send, stream, continue locally: `409 no_model` |
| `engine` (llama-server) | `apps/models/engine.py` | `/engine/start`, `/system/benchmark`: `503 engine_unavailable`; status `not_built` |
| `mirror` (model mirror) | `apps/models/mirror.py` | downloads, catalogue check: `503 mirror_unavailable` |

The evidence writer has no seam yet: `GET /evidence/checkpoints` returns `[]`, chain fields
(`epoch`, `prev_hash`, `event_hash`) are `null`, and `POST /evidence/export` checks the request
fully, then answers `503 writer_unavailable`. The export body is optional, so the old body-less
call still gets `503 writer_unavailable`.

### Differences from the plan

| Endpoint | As built |
| --- | --- |
| Added | `POST /conversations/{id}/regenerate/stream`, `GET /models/downloads/{entry_id}` |
| `GET /system/status` | Also returns `generating_conversation_id` |
| `GET /system/info` | `profile` instead of `build_channel`; no `evidence_db` path (the backend declares one database) |
| `POST /conversations/{id}/stop` | Waits up to 10 s for the answer to end; `504 stop_timeout` if it does not |
| Stream events | `started`, `phase`, `delta`, then `done`, or `error` with `answer_interrupted` (partial answer included) or `internal_error`. The answer is stored even if the client disconnects |
| `POST /restore` | `confirmed` is only required when this installation finished first run and its store opens. A locked store (key missing) can always be restored |
| `GET /evidence/{seq}` | A pending event (no `seq` yet) is found by its local `id`, the number the UI already shows |
| `GET /evidence` filters | `event_type` (repeatable), `from`, `to`, `limit` |
| `POST /models/catalogue/check` | Records the version the mirror offers. The bundled catalogue stays in use until the signing key exists (I-01) |
| Download failures | `error` is one of `size_mismatch`, `digest_mismatch`, `download_incomplete`, `mirror_unreachable`, `model_installed` |

New error codes the UI will need in `bridge/live.ts` `MESSAGES`: `busy`, `not_generating`,
`stop_timeout`, `not_partial`, `message_not_found`, `event_not_found`, `invalid_range`,
`nothing_to_export`, `log_folder_missing`, `download_exists`, `download_not_found`,
`not_downloading`, `not_enough_disk`, `download_incomplete`, `mirror_unreachable`,
`engine_unavailable`, `engine_failed`, `catalogue_check_off`, `catalogue_unreachable`,
`catalogue_signature_invalid`.

### Schema and shared code

- Migration `0005_benchmarks`: one new table, `benchmarks` (models app).
- `aios_backend/runtime.py`: the in-process registry of the answer being generated (Stop, busy,
  status). Not stored.
- `db/lookups.py`: new one-value reads/writes across apps (`setting_flag`, `catalogue_version`,
  `record_catalogue_check`, `store_identity`, `restore_count`).
- `config.Settings`: `company_base_url`, `company_model_name` (operator-set; never the API key).

### Not done yet (next step)

- `packages/ts/bridge-contract`, `apps/desktop/src/main/ipc/` and `apps/ui/src/bridge/api.ts`:
  shapes, handlers and calls for the new endpoints, including forwarding the event stream from
  main to the window. Only the restore change is wired (the bridge sends `confirmed: true` after
  the confirm dialog and reads `epoch`), so the existing restore flow keeps working.
- The real engine, mirror client and evidence writer behind the seams.

### Tests

117 backend tests pass (78 before, 39 new: `test_chat_streaming.py`, `test_models_runtime.py`,
`test_system_evidence.py`, two restore tests in `test_setup.py`). ruff, ruff format, import-linter
(6 contracts kept), mypy strict and `aios-backend openapi --check` pass. The UI and desktop
typecheck, and their unit tests pass.

## 15. Database tables per app (migration 0006)

Shared tables (projects, conversations, provider moves, messages, summaries, evidence outbox) stay
in `services/backend/db/models.py`, because several apps read them and apps never import each
other. Each app's `models.py` holds the tables only that app uses.

| App | Table | What it holds | Used by |
| --- | --- | --- | --- |
| models | `installed_models`, `hardware_profile`, `benchmarks` | (before 0006) | Models, Hardware |
| models | `model_downloads` | Unfinished downloads, so a paused or interrupted one is listed after a restart and resumes from its `.download` file | `/models/downloads*` |
| models | `engine_fallbacks` | Each GPU-to-CPU fallback and when its notice was dismissed | `/engine/status`, `/engine/fallback/acknowledge` |
| evidence | `evidence_receipts` | Epoch and chain hashes of each appended event | `/evidence`, `/evidence/{seq}` |
| evidence | `evidence_checkpoints` | Signed checkpoints the writer reported | `/evidence/checkpoints` |
| evidence | `evidence_writer_state` | One row: the writer's last report (device id, epoch, tips, last seen) | `/evidence/status`, `/evidence/stream` |
| projects | `project_packages` | Export and import history; a repeated import gets a warning | new `GET /projects/{id}/packages` |
| search | `search_entries` + FTS5 `message_search` | Trigram full-text index, kept current by triggers on `messages` | `/search` (3+ characters) |
| settings, setup | `settings`, `store_identity`, `setup_state` | (before 0006) | Settings, Setup |
| chat | none of its own | Uses the shared tables; the answer in progress is process state (`runtime.py`) | |

The evidence tables are filled by `apps/evidence/service.py` `record_append`, `record_checkpoint`
and `record_writer_report`. The code that sends the outbox to the evidence writer will call them
with the writer's replies; until then they stay empty and nothing changes for the user.
