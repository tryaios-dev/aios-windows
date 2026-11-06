# Platforms: Windows now, other operating systems later

AIOS ships for **Windows 10 and 11 only**. All code that depends on the operating system sits
behind one platform layer per language, so a later port to macOS or Linux adds one file per layer
and leaves the rest of the code unchanged. Tests fail if OS-specific code appears outside these
layers.

## The three layers

| Layer | Where | Windows implementation | What it decides |
| --- | --- | --- | --- |
| Python (backend) | `packages/py/aios-common/src/aios_common/platforms/` | `windows.py` | Data folder, the key store the app must use, reading the hardware, how the engine is started and tied to the backend (program suffix, minimal environment, kill-on-close job, orphan detection) |
| Electron main | `apps/desktop/src/main/platform/` | `windows.ts` | How the backend starts (program, environment), stopping its process tree |
| UI wording | `apps/ui/src/lib/platform.ts` | the `windows` entry | Every OS word the screens show: key store name, folders, disk encryption, installer |

All three use the same platform ids: `windows` today; `macos` or `linux` later.

Each code layer also has a **development fallback** called `generic`. It lets developers and CI
run the dev and test profiles, the CLI, `pnpm dev:desktop` and all tests on Linux or macOS. It
is never shipped:

- The Python desktop profile raises `UnsupportedPlatform` on it.
- The installed Electron app shows "This version of AIOS runs on Windows only" and quits.

**The rule for everyone else:** never check the OS yourself. Ask the layer:

- Python: `aios_common.platforms.current()`
- Electron main: `currentPlatform()`
- UI: `platform` from `@/lib/platform`

## What the guards check

| Test | Fails when |
| --- | --- |
| `packages/py/aios-common/tests/test_platforms.py` | `winreg`, `windll`, `sys.platform`, `os.name`, `LOCALAPPDATA` or `XDG_` appear in backend or shared code outside `platforms/`; the Windows key store check is missing |
| `apps/desktop/tests/unit/platform.test.ts` | `process.platform`, `.exe`, `SystemRoot`, `LOCALAPPDATA` or `taskkill` appear in `src/` outside `src/main/platform/` |
| `apps/ui/tests/platformWording.test.ts` | Windows wording (Credential Manager, `%LOCALAPPDATA%`, BitLocker, Setup.exe, "Windows user", and so on) appears in `src/` outside `lib/platform.ts` (the browser simulation's sample data is allowed) |

## What is the same on every OS

These need no change for a port:

- The API, the bridge contract, the database and its migrations.
- The Project Package, Recovery Package and Evidence Wire Format contracts.
- The screens.
- The model catalogue and the tier rule (`apps/models/hardware.py: recommended_tier`).

File paths are built with `pathlib` and `node:path`, never with hard-coded separators.

## Adding another OS (checklist)

1. **Python:** add `platforms/<os>.py` implementing `Platform`:
   - `data_dir`;
   - `hardware`;
   - `keyring_backend`: for example `keyring.backends.macOS.Keyring`, or the Secret Service backend on Linux;
   - engine processes: `exe_suffix`, `child_env` (minimal environment, IPC-32), `kill_on_close_job` (the engine dies with the backend, IPC-50; Windows uses a Job Object) and `orphan_parent_pid` (IPC-52).

   Register it in `_BY_SYS_PLATFORM` and `_BY_ID` in `platforms/__init__.py`. Keep `shipped = False` until step 7.
2. **Electron main:** add `src/main/platform/<os>.ts` implementing `DesktopPlatform`:
   - the packaged backend program and its minimal environment;
   - the dev Python path;
   - how to stop the process tree.

   Register it in `BY_NODE_PLATFORM`.
3. **UI:** add an entry to `PLATFORM_TEXT` in `apps/ui/src/lib/platform.ts`, and choose it at start-up. Today `platform` is fixed to Windows; take the id from `window.aios` once there are two.
4. **Build:**
   - `build/llama/manifest.json`: add a `platforms.<os>` entry with pinned zips, digests and the binary name.
   - `build/sqlcipher/pin.json`: the SQLCipher build for that OS, with `ships: true`.
   - `tools/release/sbom.py`: its `TARGET`.
   - `build/pyinstaller/backend.spec`: the binary name.
   - `apps/desktop/electron-builder.yml`: a `mac:` or `linux:` section.
   - Root `package.json`: a `package:<os>` script.
   - Signing and notarisation for that OS.
5. **CI:** run the `py-unit`, `ts-unit` and `e2e` jobs on that OS's runner; they already run on Ubuntu with the `generic` fallback. Add a packaging job.
6. **Security review:** the key store, file permissions on the data folder, and the threat-model limits shown in Settings > About. Have them reviewed (CODEOWNERS covers all three layers).
7. Set `shipped = True` in both code layers. Update the "runs on Windows only" message and this page.
