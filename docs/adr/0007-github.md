# ADR 0007 — GitHub instead of the self-hosted GitLab

**Status:** accepted · **Date:** 2026-10-28

**Context.** B-01 planned a private project on the self-hosted GitLab. The repository now lives at
`github.com/tryaios-dev/aios-windows`, and Phase 1a focuses on the Windows desktop application.

**Decision.** GitHub hosts the repository and runs CI with GitHub Actions on GitHub-hosted runners
(`windows-latest` for packaging and signing, `ubuntu-latest` for the Linux test run that M-23 requires).

| GitLab (before) | GitHub (now) |
| --- | --- |
| `.gitlab-ci.yml`, `.gitlab/ci/*.yml` | `.github/workflows/ci.yml` (every PR and `main`), `release.yml` (tags) |
| `.gitlab/CODEOWNERS` with usernames | `.github/CODEOWNERS` naming the team `@tryaios-dev/security-reviewers` |
| Protected branch + "Pipelines must succeed" | Ruleset `protect-main` (`tools/github/main-ruleset.json`) |
| Masked + protected CI variables | Repository secrets (Actions) |
| Self-registered `linux` / `windows` / `signing` runners | GitHub-hosted runners, nothing to register |
| Merge request templates | `.github/pull_request_template.md` |

**Consequences.**
- On a private repository GitHub enforces rulesets (required checks, code-owner review) only on a paid
  plan (GitHub Team or higher for organisations). Until then CI runs and reviewers are requested, but a
  red run or a missing review does not block the merge button. B-01 and B-02 stay open until the plan is
  active and `tools/github/apply-main-ruleset.ps1` has run.
- An EV certificate on a USB token cannot be used from a GitHub-hosted runner; the scripts assume Azure
  Artifact Signing (A-01).
- GitHub-hosted runners reach the internet directly, so the corporate-proxy check of B-06 is done from an
  office machine, not from CI.
