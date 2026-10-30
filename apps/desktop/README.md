# Electron shell (`apps/desktop`)

The Electron *main* process and *preload* script. It owns everything the sandboxed UI may not
touch: starting the backend, holding the launch token, the window and its security settings,
IPC, auto-update and the installer. The screens themselves are in `apps/ui`; see
[apps/ui/README.md](../ui/README.md) for how the two fit together.

## Start-up

```text
app ready (main/index.ts)
  1. startBackend()      main/backend/spawn.ts
       - launchToken(): 32 random bytes, memory only           main/backend/token.ts
       - spawn backend.exe (installed) or .venv python -m aios_backend (dev)
       - write {"token", "api_port": 0} to its stdin, close stdin
       - wait for the line  READY {"api_port": N}  (30 s timeout)
  2. registerIpc()       main/ipc/index.ts   one allow-list of methods
  3. createMainWindow()  main/window.ts      sandboxed window, strict CSP, loads the UI
  4. initUpdater()       main/updater.ts     installed app only
window-all-closed → stopBackend() → quit
```

Only one instance runs at a time; a second launch focuses the existing window.

## Files

| Path | Role |
| --- | --- |
| `src/main/index.ts` | Entry: single-instance lock, start-up order above |
| `src/main/backend/token.ts` | Per-launch token. Never logged, written, or put in argv or env |
| `src/main/backend/spawn.ts` | Starts and stops the backend, reads the READY line |
| `src/main/backend/client.ts` | HTTP client to `127.0.0.1:<port>` with `Authorization: Bearer <token>`. Only main holds the token |
| `src/main/ipc/index.ts` | Registers the single channel `aios:invoke`; rejects unknown method names |
| `src/main/ipc/*.ts` | One handler file per area (today `system.ts`). Each validates the backend reply with the zod schema from `@aios/bridge-contract` |
| `src/main/window.ts` | `BrowserWindow`: `contextIsolation`, `sandbox`, no `nodeIntegration`, CSP header, navigation and pop-ups blocked, all permission requests denied |
| `src/main/links.ts` | External links: https only, opened after the user confirms |
| `src/main/updater.ts` | `electron-updater`: check at start and once a day; offline is not an error |
| `src/main/logging.ts` | Content-free log lines: only whitelisted keys |
| `src/preload/index.cts` | Exposes `window.aios` (and nothing else) through `contextBridge` |
| `scripts/start-electron.mjs` | Dev launcher; clears `ELECTRON_RUN_AS_NODE` |
| `electron-builder.yml` | NSIS per-user installer. Bundles `../ui/dist`, `build/out/backend`, llama-server builds and licences |
| `tests/unit`, `tests/security` | Token tests; CSP tests |

## Adding a bridge method

1. Add the method and its zod schema in `packages/ts/bridge-contract`.
2. Add a handler in `src/main/ipc/<area>.ts`: validate the input, call `backend.client`, parse
   the reply with the schema. Register it in `ipc/index.ts`.
3. Expose it in `src/preload/index.cts` as `invoke("<area>.<method>", ...)`.
4. Use it from `apps/ui/src/bridge/index.ts`.

## Where things go at runtime

| | Dev (`pnpm dev:desktop`) | Installed app |
| --- | --- | --- |
| UI | `apps/ui/dist/index.html` | `resources/ui/index.html` |
| Backend | `.venv\Scripts\python.exe -m aios_backend` | `resources/backend/backend.exe` |
| Data | `%LOCALAPPDATA%\AIOS\` (both) | same |

## Commands

| Command (repo root) | What it does |
| --- | --- |
| `pnpm dev:desktop` | Builds bridge contract and UI, compiles main, starts Electron. Run again after changes |
| `pnpm --filter @aios/desktop test` / `test:security` | Unit / security tests |
| `pnpm package:win` | Full installer in `apps/desktop/release/` |

Security-relevant paths (`.github/CODEOWNERS`, need the technical reviewer): `src/main/backend/`,
`src/main/ipc/`, `src/main/window.ts`, `src/preload/` and `electron-builder.yml`.
