# ADR 0005 — Rename "AIOS" to "AIOS" everywhere

**Status:** accepted · **Date:** 2026-10-26

**Decision.** Every occurrence of `aios` / `AIOS` / `aios` in the repository becomes `aios` /
`AIOS` / `Aios`: Python packages (`aios_backend`, `aios_evidence_writer`, `aios_wire`,
`aios_common`), npm scopes (`@aios/*`), CLIs (`aios-backend`, `aios-evidence-writer`,
`aios-verify`), the renderer bridge (`window.aios`), the profile variable (`AIOS_ENV`), logger
names, docs and comments.

Two renames change meaning, not just names, and were confirmed by the product owner:

| Item | Before | After | Consequence |
| --- | --- | --- | --- |
| Evidence domain-separation tags | `aios-evidence-v1\n`, `aios-input-v1\n`, `aios-output-v1\n` | `aios-evidence-v1\n`, `aios-input-v1\n`, `aios-output-v1\n` | Every event hash and commitment differs from one computed with the old tags. Nothing is frozen and no golden vectors exist yet, so no stored data is affected. **MVP spec Section 9.2 must be updated to the new tags before Evidence Wire Format v1 freezes (week 2).** |
| Domain in contract `$id`s and the app ID | `tryaios.com`, `com.tryaios.aios` | `tryaios.com`, `com.tryaios.aios` | Schema IDs are identifiers, not fetched. The Windows app ID changes the per-user install identity; harmless before the first pilot build. **Master spec Section 3 names tryaios.com as the official domain; update it, or revert this row, before release.** |

**Unchanged:** `Sovereign AIOS` product name and `%LOCALAPPDATA%\SovereignAIOS` data folder
(they never contained "aios").
