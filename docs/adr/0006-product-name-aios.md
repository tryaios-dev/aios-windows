# ADR 0006 - The product name is AIOS

**Status:** accepted · **Date:** 2026-10-27

**Decision.** The product is called **AIOS** everywhere: window title, installer
(`AIOS Setup <version>.exe`), SBOM, docs. Not "Sovereign AIOS", not "SAIOS".

**Consequences.**
- Per-user data folder: `%LOCALAPPDATA%\AIOS` (was `%LOCALAPPDATA%\SovereignAIOS`).
- Windows Credential Manager entry: `AIOS` / `db-key` (was `SovereignAIOS` / `db-key`).
- No users had installed the app yet, so nothing is migrated; old development data in the
  previous folder and keystore entry can be deleted.
