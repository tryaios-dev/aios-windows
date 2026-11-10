# Contracts

The source of truth for formats shared between processes, languages and releases. Python and
TypeScript code implement these files; `apps/verifier-cli` reads only `contracts/`.

| Contract | Folder | Version | Status | Freezes (week / ticket) | Owner of the code |
| --- | --- | --- | --- | --- | --- |
| Process and IPC | `process-ipc/v1` | 1 | ready for review (vectors in CI; `FROZEN` on reviewer approval) | week 1 / D-02 | Electron main, backend, evidence writer |
| Evidence Wire Format | `evidence-wire-format/v1` | 1 | draft | week 2 / F-02 | Evidence writer (Python), verifier (TypeScript) |
| Recovery Package | `recovery-package/v1` | 1 | draft | week 2 / E-03 | Backend recovery app |
| Model Catalogue | `model-catalogue/v1` | 1 | draft | week 4 / I-01 | Backend catalogue app, `tools/catalogue/sign.py` |
| Project Package | `project-package/v1` | 1 | draft | week 6 / J-01 | Backend portability app |
| Network allowlist | `network-allowlist/v1` | 1 | draft (placeholder hosts until B-06) | fixed in the 1a build / G-08 | Backend `net/`, `config/allowlist.py`; Electron updater |
| Local API | `local-api/openapi.json` | — | not frozen; drift-checked | — | Generated from FastAPI (`aios-backend openapi --check` in CI) |

Each `v1/` folder holds `spec.md`, JSON Schemas (draft 2020-12, `"x-status": "draft"`) and an
empty `golden-vectors/` folder that the freezing ticket fills.

**Extension rule (all six):** later versions add optional fields only; semantics never change.
A contract is frozen when its freezing ticket adds the golden vectors and a `FROZEN` file to its
`v1/` folder; after that a semantic change needs a new version and an ADR.

**Common primitives** (restated in each spec so each stands alone): RFC 8785 JCS canonical JSON
with integers only; SHA-256 with domain tags `SHA-256(tag ‖ 0x00 ‖ bytes)`; Ed25519 (RFC 8032);
Argon2id (RFC 9106); AES-256-GCM; base64url without padding; RFC 3339 UTC time.

Every spec ends with a **Spec check** list (items to confirm against the MVP / Master
specification text, which is not in this repository) and **Open questions** with PROPOSED
answers to confirm against open questions 1 and 6–13.
