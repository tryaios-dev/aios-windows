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
app/
  App.tsx                Providers: react-query, HashRouter, motion, tooltips
  AppRoutes.tsx          Route table; joins features together
  session.ts             App-level state (first run done?) so features never import each other
  ErrorBoundary.tsx      Content-free error screen
bridge/index.ts          The ONLY file that touches window.aios (lint-exempt, everything else is not)
components/ui/           Design-system primitives: button, chips, feedback, fields, layout, overlays, brand
lib/                     Helpers: cn, format, motion easing, useMediaQuery, shared domain types
styles/app.css           Design tokens (colours, type, radii, shadows, motion) on Tailwind 4
assets/brand/            AIOS wordmarks and icons (imported so they resolve under file://)
features/
  setup/                 First-run wizard: 6 steps
  workspace/             App shell: sidebar, project header + tabs, conversations empty state
```

### Features

One feature = one folder in `src/features/`, with an `index.ts` that is its public surface.
Features never import each other; `app/` wires them together.

| Feature | Route | Screens | Backend package |
| --- | --- | --- | --- |
| `setup` | `#/setup` | Welcome, Your machine, Get a model, Verified, Secure your data, Start the engine | `aios_backend.apps.setup` |
| `workspace` | `#/projects/:id` | Sidebar, project header, Conversations tab (empty state). Evidence, Project settings, Models and Settings show a "not built yet" screen | `aios_backend.apps.workspace` |

Inside a feature:

| File | Holds |
| --- | --- |
| `index.ts` | What other code may import |
| `*.tsx` (and `steps/` for the wizard) | Screens and their parts |
| `store.ts` | The feature's state (zustand). **Simulated today**; each action is where a `bridge` call goes |
| `types.ts`, `catalogue.ts` | Feature-local types and placeholder data |

### Data today

There are no setup or workspace endpoints yet, so both stores simulate the backend (hardware,
download progress, recovery key, benchmark, projects, counts, engine status). When an endpoint
lands, replace the store action with a react-query hook in `src/bridge/index.ts`. First-run
state lives in memory, so a reload starts setup again until the backend owns it.

## Rules (checked in CI)

- No `fetch`, `XMLHttpRequest`, `WebSocket`, Node built-ins, `electron` or `eval` in `apps/ui`
  (`packages/ts/config/eslint.renderer.js`).
- Hash routing (`#/…`): the page is loaded from `file://`, where path routing cannot work.
- Assets are imported, never referenced by absolute `/path` (breaks under `file://`).
- The built `index.html` gets the strict CSP meta tag (`vite.config.ts`), matching `window.ts`.

## Commands

| Command (repo root) | What it does |
| --- | --- |
| `pnpm dev:ui` | UI in a browser at http://localhost:5173, instant reload, no `window.aios` |
| `pnpm dev:desktop` | Builds the UI, starts Electron + backend. No hot reload: run it again after changes |
| `pnpm --filter @aios/ui typecheck` / `lint` / `test` | Checks for this package |
| `pnpm --filter @aios/ui build` | Production build to `apps/ui/dist` |
