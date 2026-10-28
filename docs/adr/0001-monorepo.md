# ADR 0001 — One monorepo for backend, desktop and verifier

**Status:** accepted · **Date:** 2026-10-26

**Context.** One product, one installer, two developers, 12 weeks. The Python writer and the
TypeScript verifier must agree byte for byte on frozen contracts; the UI depends on the
backend's API.

**Decision.** A single repository (GitHub since 2026-10-28, see ADR 0007): a uv workspace (`services/`, `packages/py/`) and a
pnpm + Turborepo workspace (`apps/`, `packages/ts/`), with `contracts/` at the root.

**Consequences.**
- A contract change, the writer tests, the verifier tests, the API spec and the UI types land
  in one pull request; CI checks them together.
- One pipeline builds both halves and signs one installer; no version pinning between repos.
- Separation is enforced by import-linter, eslint and CODEOWNERS, not by repository walls.
- If Phase 2 brings separate teams, `services/` + `contracts/` + `packages/py/` can be split out
  with history using `git filter-repo`.
