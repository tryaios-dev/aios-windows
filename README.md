# AIOS - Windows desktop app

Electron + React desktop app with a local FastAPI backend and an encrypted SQLite database
(SQLCipher). The UI never talks to the network; it reaches the backend only through Electron.

```text
React UI (apps/ui)  --window.aios-->  Electron main (apps/desktop)  --HTTP + token-->  FastAPI backend (services/backend)  -->  chats.db (SQLCipher)
```

## Architecture

| Layer | Package | Details |
| --- | --- | --- |
| Frontend: React screens + Electron shell | `apps/ui`, `apps/desktop` | [apps/ui/README.md](apps/ui/README.md), [apps/desktop/README.md](apps/desktop/README.md) |
| Backend: FastAPI + encrypted database | `services/backend` | [services/backend/README.md](services/backend/README.md) |
| Shared plumbing | `packages/ts/bridge-contract`, `packages/py/aios-common` | [bridge-contract](packages/ts/bridge-contract/README.md), [aios-common](packages/py/aios-common/README.md) |
| Why things are built this way | `docs/adr/` | e.g. [0008 UI stack](docs/adr/0008-ui-stack.md), [0009 backend layout](docs/adr/0009-backend-layout.md) |

Features are named the same on both sides, one folder each:

| Feature | UI (`features/`) | Backend (`apps/`) |
| --- | --- | --- |
| First-run setup (6 steps) | `apps/ui/src/features/setup` | `services/backend/aios_backend/apps/setup` |
| Workspace shell | `apps/ui/src/features/workspace` | `services/backend/aios_backend/apps/workspace` |

The UI screens are built; they run on simulated data until the backend apps get endpoints.
The backend app packages are the layout only (no endpoints, tables or logic yet).

## 1. Install the tools (once per machine)

Windows 11, PowerShell. No admin rights needed except where winget asks.

| Tool | Version | Why this version |
| --- | --- | --- |
| Git | any | |
| Node.js | **22** (pinned in `.nvmrc`) | Node 23+ breaks Electron's install; `pnpm` refuses other versions |
| pnpm | 9.12.0 | Comes from corepack (pinned in `package.json`) |
| uv | latest | Installs Python 3.12 and the Python packages |

```powershell
# Git
winget install --id Git.Git -e

# Node 22 through fnm (lets you keep other Node versions side by side)
winget install --id Schniz.fnm -e
# open a NEW PowerShell window, then:
fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression
if (!(Test-Path $PROFILE)) { New-Item -ItemType File -Path $PROFILE -Force | Out-Null }
Add-Content $PROFILE 'fnm env --use-on-cd --shell powershell | Out-String | Invoke-Expression'
fnm install 22
fnm use 22
node -v                      # must print v22.x

# pnpm 9.12 through corepack
corepack enable
corepack prepare pnpm@9.12.0 --activate
pnpm -v                      # 9.12.0

# uv (Python manager)
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
# open a NEW PowerShell window, then:
uv --version
uv python install 3.12
```

No fnm? Install Node **22** LTS from https://nodejs.org instead. Check with `node -v`.

## 2. Get the code and install dependencies

```powershell
git clone https://github.com/tryaios-dev/aios-windows.git
cd aios-windows

uv sync --frozen --all-packages --all-extras    # Python 3.12 + packages exactly from uv.lock
pnpm install --frozen-lockfile                  # Node packages exactly from pnpm-lock.yaml (includes Electron)
pnpm check:all                                  # must end green
```

`pnpm check:all` runs: ruff, import rules, mypy, Python tests (17 backend + shared), TypeScript
typecheck, eslint and vitest. Expected ending: `Tasks: 10 successful, 10 total`.

## 3. Run and verify

Use three PowerShell windows, all in the `aios_desktop` folder.

### Window 1 - backend (FastAPI)

```powershell
pnpm dev:backend
```

Expected: it prints `READY {"api_port": 8765}`. Then open in a browser:

| URL | Expected |
| --- | --- |
| http://127.0.0.1:8765/health | `{"backend":"ok","database":"ok","version":"0.1.0"}` |
| http://127.0.0.1:8765/docs | Swagger page listing the API |

Or from PowerShell: `Invoke-RestMethod http://127.0.0.1:8765/health`

The dev backend opens `/health` and `/docs` without a token so a browser can reach them. Every
other path needs the token printed in the window. The shipped `backend.exe` needs the token for
everything and has no `/docs`.

### Window 2 - UI in the browser (React + Vite)

```powershell
pnpm dev:ui
```

Open http://localhost:5173. Expected: the first-run wizard, *Private AI on this computer.*
Click through the six steps to reach the workspace (setup data is simulated). The UI is not
allowed to call the network, and `window.aios` (its only way to the backend) exists only inside
Electron. Use this mode for layout work; edits reload instantly.

### Window 3 - the desktop app (Electron)

```powershell
pnpm dev:desktop
```

Expected: a window opens with the same first-run wizard as Window 2. Electron starts its own
backend with a fresh token, so Window 1 is not needed for this. It builds the UI once at start,
so run it again after UI changes. Close the window to stop both.

The desktop app uses the real per-user locations: database in
`%LOCALAPPDATA%\AIOS\data\chats.db`, key in Windows Credential Manager
(`AIOS` / `db-key`, created on first start).

## 4. Build the installer (optional)

```powershell
pnpm package:win
```

Produces `build\out\backend\backend.exe` and `apps\desktop\release\AIOS Setup 0.1.0.exe`
(unsigned locally; the release job in CI signs it). To try the packaged app without installing:
run `apps\desktop\release\win-unpacked\AIOS.exe`.

## Everyday commands

| Command | What it does |
| --- | --- |
| `pnpm check:all` | Everything CI runs (Python + TypeScript) |
| `pnpm check:py` / `pnpm check` | Python half / TypeScript half |
| `uv run aios-backend routes` | List API routes |
| `uv run aios-backend openapi` | Regenerate `contracts/local-api/openapi.json` (CI checks it is current) |
| `pnpm build:backend` | `build/out/backend/backend.exe` (PyInstaller) |
| `pnpm sbom` | CycloneDX SBOM in `build/out/sbom/` |
| `uv run python tools/release/dependency_scan.py` | Python dependency scan |

### Database (chats.db)

Dev database: `services/backend/.dev/chats.db` (fixed dev key, throw-away data).

| Command | What it does |
| --- | --- |
| `uv run aios-backend migrate` | Create or upgrade the dev database (backs it up first) |
| `uv run aios-backend makemigrations -m "add tags"` | After editing `db/models.py`: write the next numbered migration; review it |
| `uv run aios-backend showmigrations` / `downgrade -1` | List migrations / undo the newest |
| `uv run aios-backend check` | Opens with its key, SQLCipher version, at head, models match migrations |
| `uv run aios-backend sql "SELECT * FROM preferences"` | One SQL statement on the encrypted dev database |
| `uv run aios-backend reset-db --yes` | Delete the dev database |

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `ERR_PNPM_UNSUPPORTED_ENGINE` | Wrong Node version. `fnm use 22`, check `node -v` |
| "Electron is not installed correctly" | It was installed with Node 23+. Switch to Node 22, delete every `node_modules` folder, `pnpm install` |
| `pnpm dev:ui` exits at once | Port 5173 is taken (an old Vite). Close it, or find it with `netstat -ano \| findstr :5173` |
| `pnpm dev:backend`: address in use | Port 8765 is taken. Close the old backend or run `uv run aios-backend serve --port 8770` |
| Electron says `import "electron"` failed | Something set `ELECTRON_RUN_AS_NODE` (VS Code does). `pnpm dev:desktop` clears it; when starting Electron another way, clear it yourself |
| `pnpm package:win`: "cannot execute" while extracting winCodeSign | Windows blocks symlinks. Turn on Settings > System > For developers > Developer Mode, or run the terminal as administrator once |
| Health shows `"database":"locked"` | A `chats.db` exists but its key is not in Credential Manager. Restore the key, or (test machines only) delete `%LOCALAPPDATA%\AIOS\data\chats.db` |

## Repository layout

| Path | What it is |
| --- | --- |
| `apps/desktop/` | Electron main + preload: launch token, starts the backend, IPC, auto-update, installer config ([README](apps/desktop/README.md)) |
| `apps/ui/` | React renderer (Vite, Tailwind). One folder per feature in `src/features/` ([README](apps/ui/README.md)) |
| `packages/ts/bridge-contract/` | Types + zod schemas of the `window.aios` bridge ([README](packages/ts/bridge-contract/README.md)) |
| `packages/ts/config/` | Shared tsconfig and eslint rules (renderer: no network, no Node) |
| `services/backend/` | `backend.exe`: `aios_backend/` (FastAPI app: `main.py`, `routes.py`, `config.py`, `cli.py`, `__main__.py`, one package per feature in `apps/`) and `db/` (chats.db) ([README](services/backend/README.md)) |
| `packages/py/aios-common/` | Token handshake, loopback/token middleware, keystore, content-free logging, paths ([README](packages/py/aios-common/README.md)) |
| `contracts/` | Launch handshake, network allowlist, generated OpenAPI file |
| `build/` | PyInstaller spec, signing scripts, SQLCipher and llama.cpp pins |
| `tools/` | Test runner, SBOM, dependency scans, update feed |
| `docs/` | ADRs ([docs/adr/](docs/adr/): why each major choice was made), Developer Brief and Backend Commands (Word), GitHub setup, week-1 status, signing record (A-01), dependency exceptions record |

Rules every change follows: [CLAUDE.md](CLAUDE.md). CI: `.github/workflows/`. Server-side GitHub
settings: [docs/github-setup.md](docs/github-setup.md). Task status: [docs/week1-status.md](docs/week1-status.md).

## Project contacts (A-02)

The reviewer and deputy are the members of the GitHub team `@tryaios-dev/security-reviewers`, which
`.github/CODEOWNERS` names on every security-relevant path. The same list is kept in Plane.

| Role | Name | GitHub user | Turnaround accepted in writing (date, where filed) | In Plane |
| --- | --- | --- | --- | --- |
| Technical reviewer (2-working-day turnaround) | _TBD_ | _TBD_ | _TBD_ | [ ] |
| Deputy reviewer | _TBD_ | _TBD_ | _TBD_ | [ ] |
| Product owner (scope decisions) | _TBD_ | | n/a | [ ] |
| IT contact (proxy, certificates, hosting) | _TBD_ | | n/a | [ ] |
| Legal contact (gates L1-L7) | _TBD_ | | n/a | [ ] |

If the reviewer and the deputy are both unavailable, security-relevant work is parked, never merged unreviewed.
