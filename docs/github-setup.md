# GitHub setup (B-01, B-02, B-04, B-06)

Settings that cannot live in the repository. Do once, as an organisation owner of `tryaios-dev`.

1. **Plan.** On a private repository, rulesets (required checks, code-owner review) are enforced only on
   GitHub Team or higher. Without it, steps 4 and 5 cannot be applied and B-01/B-02 are not enforced.
2. **Push the code.**
   ```powershell
   git add .
   git commit -m "Import AIOS desktop (Phase 1a)"
   git push -u origin main
   ```
3. **Reviewer team (A-02).** Organisation → Teams → New team `security-reviewers`; add the technical
   reviewer and the deputy. Repository → Settings → Collaborators and teams → give the team **Write**.
   `.github/CODEOWNERS` already names `@tryaios-dev/security-reviewers` on every security-relevant path.
4. **Protect `main` (B-01, B-02).** After the first CI run has finished (so the check names exist):
   ```powershell
   gh auth login
   powershell -File tools/github/apply-main-ruleset.ps1
   ```
   This creates the ruleset `protect-main`: no direct pushes or force-pushes, pull request with one
   approval, **code-owner review required**, conversations resolved, and all CI jobs green
   (`py-lint`, `py-unit` ×2, `ts-lint`, `ts-unit` ×2, `package-windows`, `audit`).
   The same can be done by hand under Settings → Rules → Rulesets.
5. **Merge settings.** Settings → General → Pull requests: allow squash merging; turn on
   "Automatically delete head branches".
6. **Secrets (B-04, B-06).** Settings → Secrets and variables → Actions → New repository secret:
   `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AIOS_SIGN_ENDPOINT`,
   `AIOS_SIGN_ACCOUNT`, `AIOS_SIGN_PROFILE` (from A-01), and `AIOS_FEED_UPLOAD_CMD` (from A-05/B-06).
   GitHub masks them in logs; never put them in files.
7. **Actions.** Settings → Actions → General: allow GitHub Actions; workflow permissions "Read
   repository contents" (release.yml asks for `contents: write` itself).

## Checking the acceptance criteria

- **B-01**: open a test PR that changes `services/backend/src/aios_backend/gateway/__init__.py`.
  GitHub requests a review from `security-reviewers`; the merge button stays blocked until the reviewer
  or the deputy approves.
- **B-02 step one**: open a PR that breaks a test. `py-unit (ubuntu-latest)` and
  `py-unit (windows-latest)` go red and the PR cannot merge.
- **B-02 step two**: the `package-windows` job uploads the artefact `aios-windows-unsigned` with
  `backend.exe` and `AIOS Setup x.y.z.exe` (kept 14 days).
- **B-02 lock files**: add a dependency to a `pyproject.toml` or `package.json` without relocking;
  `py-lint` (`uv lock --check`) or `pnpm install --frozen-lockfile` fails.
- **B-04**: push a tag `v0.1.0`. `release.yml` signs backend.exe, both llama-server builds, the Electron
  files and the installer, then `verify-signatures.ps1` fails the job on any unsigned PE file.
- **B-05**: the release run carries `build/out/sbom/aios-sbom.cdx.json`; the `audit` job is green or
  every finding is in `docs/security/dependency-exceptions.json`.
