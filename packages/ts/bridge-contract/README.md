# `@aios/bridge-contract`

The definition of `window.aios`: the only way the UI reaches the rest of the system. Electron
main, the preload script and the UI all import it, so the three cannot drift apart.

```text
apps/ui (calls)  ──►  preload (exposes)  ──►  main/ipc (validates)  ──►  backend
        └────────── all three import @aios/bridge-contract ──────────┘
```

## What it contains (`src/index.ts`)

| Export | What it is |
| --- | --- |
| zod schemas, e.g. `Health` | The shape of each reply. Electron main parses every backend reply with them before it reaches the UI |
| Types, e.g. `type Health` | Inferred from the schemas, used by the UI and preload |
| `AiosBridge` | The interface of `window.aios`, grouped by area (`system.health()` today) |
| `Channels` | IPC channel names. There is one: `aios:invoke` |

## Rules

- Change this package first when adding a call, then `apps/desktop` (IPC handler and preload),
  then `apps/ui/src/bridge`. Steps are in [apps/desktop/README.md](../../../apps/desktop/README.md).
- No secrets, tokens or ports in the interface: the UI must never see them.
- It is a security-relevant path (`.github/CODEOWNERS`); changes need the technical reviewer.
- Its only runtime dependency is `zod`.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm --filter @aios/bridge-contract build` | Compiles to `dist/` (the UI and desktop import the build). `pnpm dev:ui` and `pnpm dev:desktop` run it for you |
| `pnpm --filter @aios/bridge-contract typecheck` | Type check |
