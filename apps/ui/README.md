# Frontend: React UI (`apps/ui`) + Electron shell (`apps/desktop`)

The desktop app is two packages that ship together:

| Package | What it is | Runs where | May use |
| --- | --- | --- | --- |
| `apps/ui` | React screens (the *renderer*) | Inside the Electron window, sandboxed | `window.aios` only |
| `apps/desktop` | Electron *main* + *preload* | Node.js process on Windows | OS, files, child processes, the backend |

Visual and UX reference: the `aios-product-designs` prototype. Screens are ported from its code,
not redrawn from screenshots.

## How React and Electron work together

```text
┌──────────────── Electron window (sandboxed, no Node) ────────────────┐
│  apps/ui  React + Vite build (ui/dist/index.html)                    │
│     features/*  ──calls──►  src/bridge/index.ts  ──►  window.aios    │
└──────────────────────────────────────────────┬───────────────────────┘
                                               │ ipcRenderer.invoke("aios:invoke", method, …args)
┌──────────────── apps/desktop ────────────────▼───────────────────────┐
│  preload/index.cts   exposes window.aios (shape = @aios/bridge-contract)
│  main/ipc/*.ts       allow-list of methods, zod-validates every call │
│  main/backend/       starts backend, holds the launch token          │
│        client.ts  ──HTTP 127.0.0.1 + Bearer token──►  FastAPI backend │
└──────────────────────────────────────────────────────────────────────┘
```

1. **Start.** `apps/desktop/src/main/index.ts` starts the backend (`backend/spawn.ts`). It
   generates a per-launch token, sends it to the backend over stdin, and waits for the
   `READY {"api_port": …}` line.
2. **Window.** `main/window.ts` opens a `BrowserWindow` with `contextIsolation`, `sandbox` and
   a strict CSP (no network, no inline script), then loads `apps/ui/dist/index.html` (dev) or
   `resources/ui/index.html` (installed app).
3. **Bridge.** `preload/index.cts` puts one object on the page: `window.aios`. Its type is
   `AiosBridge` from `packages/ts/bridge-contract`. The UI never receives the token or the port.
4. **A call.** The UI calls, for example, `window.aios.system.health()`. Preload forwards it as
   `aios:invoke("system.health")`. `main/ipc/` rejects unknown methods, calls the backend with
   the token, validates the reply with zod and returns it to the page.

Adding a backend call therefore touches four places, in this order: `bridge-contract` →
`desktop/src/main/ipc/` → `desktop/src/preload/` → `ui/src/bridge/`.

## UI layout (`apps/ui/src`)

```text
main.tsx                 Mounts <App/> and the stylesheet
app/                     The shell; the only place that imports features
  App.tsx                Providers: react-query, HashRouter, motion, tooltips
  AppRoutes.tsx          Route table, first-run guard, global dialogs and toasts
  AppLayout.tsx          Sidebar + main area; shortcuts Ctrl K (search), Ctrl , (settings), Ctrl \ (sidebar)
  Sidebar.tsx            Projects, Models, Settings, engine and evidence status
  ProjectLayout.tsx      Project header: name, class chip, New conversation, actions menu, tabs
  GlobalDialogs.tsx      Dialogs any screen can raise (continue locally, choose a model)
  Toaster.tsx            Toast stack
bridge/
  index.ts               The ONLY file that touches window.aios
  api.ts                 Endpoint façade: one function per local API endpoint (MVP 9.3)
  live.ts                Desktop app: loads the backend's data into the store; error messages
  useSearch.ts           Search hook (backend in the desktop app, the store in a browser)
  sim/                   SIMULATED backend behind api.ts until the real endpoints exist
    store.ts             All app state and simulated behaviour (zustand)
    catalogue.ts         Model Catalogue v1 entries and the sample hardware profile
    answers.ts           Canned chat answers
    flags.ts             Simulation switches (defaults = pilot build)
components/
  ui/                    Design-system primitives: button, chips, feedback, fields, layout, overlays, brand
  app/                   App-level pieces shared by features: SettingRow, RenameDialog, FallbackNotice, useEngineStatus
lib/                     cn, format, hash, useMediaQuery, domain types (MVP 9.1-9.6 field names)
styles/app.css           Design tokens on Tailwind 4, plus Markdown typography for answers
assets/brand/            AIOS wordmarks and icons (imported so they resolve under file://)
features/                One folder per feature (below)
```

### Features

One feature = one folder in `src/features/`, with an `index.ts` that is its public surface.
Features never import each other; `app/` wires them together, and pieces two features need live
in `components/app/`. Each has a backend package of the same name in
`services/backend/aios_backend/apps/`.

| Feature | Route | Screens |
| --- | --- | --- |
| `setup` | `#/setup`, `#/setup/restore` | First-run wizard (Welcome, Your machine, Get a model, Verified, Secure your data, Start the engine) and Restore from a backup |
| `chat` | `#/projects/:id`, `#/projects/:id/c/:conversationId` | Conversation list, chat pane, composer, answers in Markdown, provider and model badges |
| `evidence` | `#/projects/:id/evidence` | Stream summary, event timeline with filters, event detail sheet, evidence export |
| `projects` | `#/projects/:id/settings` | Project settings; New project, Rename, Change classification, Archive, Delete; Project Package export and import |
| `models` | `#/models` | This machine, default model, catalogue with download, import and delete |
| `settings` | `#/settings/:section` | General, Engine, Network, Hardware, Health, Data and recovery, About |
| `search` | `#/search`, Ctrl K | Search page and command palette |

### Data today

**Desktop app: everything comes from the backend.** `main.tsx` calls `hydrate()` from
`bridge/live.ts` before the first render. Screens still read the zustand store with
`useStore(...)`, but in the desktop app the store only holds what the backend returned:
`api.ts` sends each change through `window.aios` → Electron main → backend, then `live.ts`
reloads what the change touched (projects, conversations, messages of the open conversation,
evidence, models, settings). A failed call shows a toast in plain words (`MESSAGES` in `live.ts`).
Reloads that answer out of order are dropped, so a quick second change never shows stale data.

| Area | In the desktop app |
| --- | --- |
| Setup and restore | Store, recovery key (shown once), default project; restore with the folder dialog |
| Settings | All switches, default model, update check, network list |
| Projects | Create, rename, archive, reclassify (reviewed copy), Company AI, package export (save dialog) and import (open dialog) |
| Chat | Conversations, messages, provider moves, regenerate. Answers need the local engine, which is not in this build: sending shows "No local model is ready" |
| Search | `GET /search` through `bridge/useSearch.ts` |
| Evidence | The backend's events (all pending until the evidence writer exists); export says it waits for the writer |
| Models | Catalogue, installed models, import of a .gguf file (checked against the catalogue), delete, this machine's hardware. Download and the benchmark say they are not in this build |

**Plain browser (`pnpm dev:ui`):** no `window.aios`, so `api.ts` uses the simulated backend in
`src/bridge/sim/` (canned answers, simulated downloads). Use it for layout work. The workspace is
kept in browser storage (`aios-sim-v1*`); clear site data to run setup again.

**Adding a call:** bridge contract → `desktop/src/main/ipc/` → `preload/index.cts` →
`ui/src/bridge/api.ts` (and a reload in `live.ts`). A desktop test fails if preload and main list
different methods.

### End-to-end test

`pnpm test:e2e` (repo root, after `uv sync`) runs `e2e/fullStack.e2e.ts`: the UI's `api.ts`,
the real preload, the real main handlers with their zod checks, and a real backend on a
throw-away database (`aios-backend serve-e2e --echo`). Only Electron itself is replaced
(`e2e/electronStub.ts`: the IPC pipe and the file dialogs). `--echo` is a test-only answer source
that repeats the question, so chat, evidence and search run before the engine exists. It covers
setup, settings, projects, chat, search, evidence, packages, models and deleting.

## Rules (checked in CI)

- No `fetch`, `XMLHttpRequest`, `WebSocket`, Node built-ins, `electron` or `eval` in `apps/ui`
  (`packages/ts/config/eslint.renderer.js`).
- Hash routing (`#/…`): the page is loaded from `file://`, where path routing cannot work.
- Assets are imported, never referenced by absolute `/path` (breaks under `file://`).
- Code is formatted with Prettier (`.prettierrc.json` at the repo root).
- The built `index.html` gets the strict CSP meta tag (`vite.config.ts`), matching `window.ts`.

## Commands

| Command (repo root) | What it does |
| --- | --- |
| `pnpm dev:ui` | UI in a browser at http://localhost:5173, instant reload, no `window.aios` |
| `pnpm dev:desktop` | Builds the UI, starts Electron + backend. No hot reload: run it again after changes |
| `pnpm --filter @aios/ui typecheck` / `lint` / `test` | Checks for this package |
| `pnpm test:e2e` | UI → preload → main → real backend, on a throw-away database |
| `pnpm --filter @aios/ui build` | Production build to `apps/ui/dist` |
