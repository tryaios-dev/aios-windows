# Frontend: React UI (`apps/ui`) + Electron shell (`apps/desktop`)

The desktop app is two packages that ship together:

| Package | What it is | Runs where | May use |
| --- | --- | --- | --- |
| `apps/ui` | React screens (the *renderer*) | Inside the Electron window, sandboxed | `window.aios` only |
| `apps/desktop` | Electron *main* + *preload* | Node.js process on Windows | OS, files, child processes, the backend |

Visual and UX reference: the `aios-prototype` design handover. Screens are ported from its code,
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
`desktop/src/main/ipc/` → `desktop/src/preload/` → `ui/src/lib/api.ts` (and a reload in
`ui/src/bridge/live.ts`).

## UI layout (`apps/ui/src`)

The screens are the `aios-prototype` design handover (12 November 2026), kept as close to its code
as possible so later design drops copy in. Its own docs (`docs/DEVELOPER-HANDOVER.md`,
`PRODUCT-DESIGN.md`, `GLOSSARY.md`) are the reference.

```text
main.tsx                 Loads the backend's data (hydrate), then mounts <App/>. A plain browser gets
                         app/DesktopOnly.tsx ("Open AIOS in the desktop app")
App.tsx                  Routes and the start-up gate (setup first; "cannot open your data")
app/                     The shell: window frame, layout, menu, project header, global dialogs, toasts
bridge/
  index.ts               The ONLY file that touches window.aios
  live.ts                Desktop app: loads the backend's data into the store; error messages
lib/
  api.ts                 The seam: one function per local API endpoint (MVP 9.3), all through window.aios
  store.ts, extras.ts    App state (zustand): only what the backend returned, plus interface state
  types.ts, words.ts, activity.ts, format.ts, platform.ts, ...
data/                    catalogue.ts (filled from GET /models/catalogue), product wording (stack.ts),
                         file kinds (knowledge.ts). No sample data anywhere
components/ui/, components/app/   Design-system primitives and shared product pieces
assets/                  Colour icons, model and resource logos, AIOS brand (imported for file://)
features/                One folder per area (below)
```

### Features

| Feature | Route | In the desktop app |
| --- | --- | --- |
| `setup` | `#/setup`, `#/setup/restore` | Store and recovery key (shown once), default project; restore with the folder dialog |
| `home` | `#/` | Reads projects, conversations, models and activity |
| `chat` | `#/projects/:id`, `…/c/:conversationId` | Conversations, messages, moves to the company server, ask again. Answers need the local engine |
| `activity` | `#/activity`, `#/projects/:id/activity` | The backend's events; verifiable copy written by the evidence writer |
| `projects` | `#/projects/:id/settings` | Create, rename, archive, sensitivity label (reviewed copy), company server, project file save and add |
| `models` | `#/models` | Catalogue, installed models, import of a .gguf file, remove, downloads, this computer's hardware |
| `search` | `#/search`, Ctrl K | `GET /search` |
| `settings` | `#/settings/:section` | Switches, update check, connections, hardware, speed test, health, diagnostic file, licences |
| `knowledge`, `skills`, `resources`, `voice` | `#/knowledge`, `#/skills`, `#/resources` | **No backend yet.** Start empty and say "not in this build yet"; nothing is simulated |

Backup and a new recovery key (Settings › Backup and recovery) have no backend yet either.

### Data

**Desktop app: everything comes from the backend.** `main.tsx` calls `hydrate()` from
`bridge/live.ts` before the first render; it first clears the browser preview's sample data. Screens
read the zustand store with `useStore(...)`, but in the desktop app the store only holds what the
backend returned: `lib/api.ts` sends each change through `window.aios` → Electron main → backend,
then `live.ts` reloads what the change touched. A failed call shows a toast in plain words
(`MESSAGES` in `live.ts`). Reloads that answer out of order are dropped.

**Plain browser (`pnpm dev:ui`):** there is no `window.aios`, so there is no data to show and the page
says to open the desktop app. Nothing is simulated. Interface preferences (menu collapsed, last
project, setup step) are kept in browser storage (`aios-ui-v1`).

### End-to-end test

`pnpm test:e2e` (repo root, after `uv sync`) runs `e2e/fullStack.e2e.ts`: the UI's `lib/api.ts`,
the real preload, the real main handlers with their zod checks, and a real backend on a
throw-away database (`aios-backend serve-e2e --echo`). Only Electron itself is replaced
(`e2e/electronStub.ts`: the IPC pipe and the file dialogs). `--echo` is a test-only answer source
that repeats the question, so chat, evidence and search run before the engine exists.

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
| `pnpm dev:ui` | Vite dev server at http://localhost:5176; a plain browser shows "Open AIOS in the desktop app" |
| `pnpm dev:desktop` | Builds the UI, starts Electron + backend. No hot reload: run it again after changes |
| `pnpm --filter @aios/ui typecheck` / `lint` / `test` | Checks for this package |
| `pnpm test:e2e` | UI → preload → main → real backend, on a throw-away database |
| `pnpm --filter @aios/ui build` | Production build to `apps/ui/dist` |
