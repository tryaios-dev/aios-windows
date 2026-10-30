# Week 1 status: modules A and B (Windows desktop app, GitHub)

Re-checked 2026-10-28 on Windows 11 after the move from GitLab to GitHub (ADR 0007).
"Repo" = done in this repository. "Team" = needs a person, a purchase or an outside service.

## Checked locally on 2026-10-28

| Check | Result |
| --- | --- |
| `uv lock --check`, `uv sync --frozen` | pass |
| ruff check + format, import-linter (4 contracts), mypy strict | pass |
| Python tests (`tools/run_tests.py`) | pass |
| `pnpm install --frozen-lockfile`, typecheck, lint, vitest, desktop security tests (Node 22) | pass |
| `aios-backend openapi --check` | up to date |
| `pnpm package:win`: llama.cpp b11960 fetched + SHA-256 verified, `backend.exe`, `AIOS Setup 0.1.0.exe` with backend, llama-server CPU + Vulkan, licences | pass (unsigned) |
| `verify-signatures.ps1` on the unsigned build | fails on 118 of 121 PE files, as it must until A-01 |
| SBOM (`tools/release/sbom.py`) | 61 components incl. Electron 33.4.11, SQLCipher 4.19.0, llama.cpp b11960 |
| Dependency scans (pip-audit, pnpm audit) | 0 open findings |

Note: Node 23+ breaks Electron's install. Use Node 22 (`.nvmrc`; `fnm use 22`).

## Module A

| Task | Acceptance criterion | Status |
| --- | --- | --- |
| A-01 | Publisher confirmed in writing; certificate/service issued to it | **Team.** Record ready: `docs/signing/A-01-validation.md`. `publisherName` in `apps/desktop/electron-builder.yml` is still a placeholder |
| A-01 | Valid signature from the named publisher on a test binary; installs on a clean Win 11 VM, no unknown-publisher warning | **Team** (needs the credential). Repo: `build/signing/test-sign-validation.ps1` builds, signs and checks a throwaway exe and writes the result |
| A-01 | SmartScreen reputation recorded separately with a plan | **Team.** Section 5 of the record, plan drafted |
| A-01 | Signing method and account holder recorded | **Team.** Section 2 of the record. Scripts assume Azure Artifact Signing; an EV token would need a cloud HSM on GitHub-hosted runners |
| A-02 | Reviewer + deputy accepted 2-day turnaround, have approval rights | **Team.** Repo: CODEOWNERS names team `@tryaios-dev/security-reviewers`; add both people to it (docs/github-setup.md step 3). Enforcement needs GitHub Team (ADR 0007) |
| A-02 | Product owner, IT, legal contacts recorded (README + Plane) | **Team.** Table in README "Project contacts" |
| A-03 | Six drafts, each with version, extension rule, freeze week | **Repo done** (drafts). See A-03 below |
| A-03 | Reviewed by the technical reviewer before the freezing tickets | **Team** (needs A-02) |
| A-04 | One small + one medium entry with every MVP 9.6 field | **Partly.** `catalogue/catalogue.draft.json`: Qwen3-4B and Qwen3-8B Q4_K_M with upstream revision, source-weight digest, conversion tool/version, quantisation, licence, publisher, pipeline. Artefact sha256/size are filled when `tools/catalogue/build_entry.py` is run (needs a llama.cpp source checkout at the pinned commit and ~30 GB disk) |
| A-04 | Third-party artefacts have a named deviation review | **Not needed yet**: default entries use our own quantisation. Qwen's official GGUFs are listed as fallbacks with review "pending" |
| A-04 | Licence texts in the repository | **Done.** `licenses/` (Qwen3 Apache-2.0, llama.cpp MIT); shipped in the installer |

A-04 notes: Gemma 4 is Apache-2.0 (Google, April 2026) but is not in the catalogue; legal should check
Google's prohibited-use policy first. Llama 4 is excluded (Llama 4 Community License). Details:
`docs/models/A-04-shortlist.md`.

## Module B

| Task | Acceptance criterion | Status |
| --- | --- | --- |
| B-01 | Repository, folder layout | **Repo.** GitHub `tryaios-dev/aios-windows` (not pushed yet). `services/evidence-writer/` and `apps/verifier-cli/` are created by their own tickets (an empty `services/*` folder would break the uv workspace) |
| B-01 | A test PR touching the gateway folder cannot merge without the reviewer | **Repo ready, Team to enforce.** `services/backend/aios_backend/gateway/` exists; `.github/CODEOWNERS`; `tools/github/apply-main-ruleset.ps1` applies the ruleset. Needs GitHub Team plan + A-02 names |
| B-01 | CLAUDE.md has the seven invariants verbatim + tests-first rule | **Team check.** Tests-first rule present. CLAUDE.md lists **8** invariants; compare with MVP 5.3 word for word (not in the repo) |
| B-02 | Lint + pytest on Linux and Windows; red pipeline blocks merge | **Repo done** (`.github/workflows/ci.yml`: `py-unit`/`ts-unit` on ubuntu + windows). Blocking needs the ruleset (Team plan) |
| B-02 | Windows job produces backend.exe and an installer | **Repo done.** `package-windows` job, artefact kept 14 days. Verified locally |
| B-02 | Lock files committed; unlocked dependency fails | **Done.** uv.lock, pnpm-lock.yaml (`--frozen`), SQLCipher pin, **llama.cpp b11960 pinned** with SHA-256 (`build/llama/manifest.json`) |
| B-04 | Release job signs all binaries; post-build check passes | **Repo done, Team credential.** `.github/workflows/release.yml` signs backend.exe, both llama-server builds, the Electron files and the installer, then fails on any unsigned PE. Needs the A-01 secrets |
| B-04 | Credential nowhere in repo or CI logs | **Done.** GitHub secrets only; secret search clean; scripts print file names only |
| B-05 | SBOM attached to the RC pipeline, matches the build | **Repo done.** release.yml uploads it and attaches it to the draft GitHub release |
| B-05 | Scan clean, or every finding in the exceptions record | **Done.** `audit` job on every PR + weekly; 0 findings |
| B-06 | Mirror serves small/medium files with range support | **Team** (hosting from A-05; files from A-04 pipeline) |
| B-06 | Feed serves a signed test release electron-updater can read | **Repo: staging done. Team:** hosting + `AIOS_FEED_UPLOAD_CMD` secret + A-01 signature |
| B-06 | Hostnames in the allowlist draft; reachable through the corporate proxy | **Team.** `models.example.eu` / `updates.example.eu` are placeholders in the allowlist, electron-builder.yml and the catalogue |

## A-03 contracts

All six drafts are in `contracts/<name>/v1/` (spec.md + JSON schemas + empty `golden-vectors/`), each with
Version 1, the extension rule and its freeze week. None is frozen. Every spec ends with a "Spec check" list
(compare against MVP 9.2–9.6 / Master 9.3, which are not in the repo) and "Open questions" with PROPOSED
answers to settle against questions 1, 6–13.

| Contract | Freezes (ticket) |
| --- | --- |
| process-ipc | week 1 (D-02) |
| evidence-wire-format | week 2 (F-02) |
| recovery-package | week 2 (E-03) |
| model-catalogue | week 4 (I-01) |
| project-package | week 6 (J-01) |
| network-allowlist | fixed in the 1a build (G-08) |

Found while drafting, for D-02 to fix (process-ipc spec §9): the backend prints READY before uvicorn has
bound its port (and `free_port()` can race), and `read_handshake` does not validate the frame.

## Waiting on the team

1. GitHub Team plan for `tryaios-dev` (enforces B-01 and B-02)
2. Legal entity name and signing method/account: A-01 (blocks M1, B-04, B-06)
3. Reviewer + deputy GitHub users, product owner, IT and legal contacts: A-02
4. MVP 5.3 / 9.2–9.6 text and answers to open questions 1, 6–13: B-01 check, A-03
5. Run the model pipeline (`tools/catalogue/build_entry.py`) for the artefact digests: A-04
6. Mirror and update-feed hosting + hostnames: A-05 → B-06
