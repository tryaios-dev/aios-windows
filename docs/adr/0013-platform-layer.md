# ADR 0013 — Windows only, behind a platform layer

**Status:** accepted · **Date:** 2026-11-05

**Context.** AIOS ships for Windows. Windows details were spread through the code:

- the data folder in `paths.py`;
- registry and Win32 calls in the models app;
- `backend.exe` and `python.exe` paths in Electron main;
- Credential Manager and `%LOCALAPPDATA%` wording in a dozen screens.

A later macOS or Linux version would have had to find and change all of them. On top of that,
the key store accepted whatever backend `keyring` picked, and stopping the dev backend left the
real Python process running. Windows' venv `python.exe` starts it as a child.

**Decision.**
- **One platform layer per language, with the same ids:**
  - `aios_common.platforms` (Python): data folder, the required key store, hardware;
  - `apps/desktop/src/main/platform` (Electron main): how the backend starts and stops;
  - `apps/ui/src/lib/platform.ts` (UI wording).

  Windows is the only implementation, and the only one marked `shipped`.
- **A `generic` development fallback** keeps dev tools, CI on Ubuntu and the tests working on
  other systems. The desktop profile and the installed app refuse to start on it.
- **The key store** on a shipped platform must be the backend the platform names (Windows:
  `WinVaultKeyring`). Otherwise `KeystoreUnavailable` is raised, so the app can never fall back
  to a plaintext store.
- **Stopping the backend** stops its whole process tree (`taskkill /T` on Windows).
- **Build inputs are keyed by platform:** llama.cpp builds in `build/llama/manifest.json`
  (`platforms.windows`), the SQLCipher pin (already keyed by `sys.platform`), and `TARGET` in
  `tools/release/sbom.py`.
- **Guard tests in each language** fail if OS-specific code or wording appears outside its
  layer.

**Consequences.**
- A port follows the checklist in `docs/platforms.md`: one new file per layer, build entries,
  CI runners and a security review. No feature code changes.
- The installed app on another OS shows "This version of AIOS runs on Windows only" and quits.
