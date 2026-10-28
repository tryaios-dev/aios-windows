## What and why

## Acceptance criteria covered
- [ ] AC-xx test written first and now passing

## Checklist
- [ ] No content, prompts, tokens or secrets in logs
- [ ] No new import outside the allowed boundaries (import-linter / eslint pass)
- [ ] New bridge call? Added to `@aios/bridge-contract` with zod validation in main
- [ ] New dependency? Lock file updated (`uv lock` / `pnpm install`) in this PR

## Security-relevant change? (paths in `.github/CODEOWNERS`)
- Component:
- Threat addressed / invariant touched:
- [ ] Technical reviewer requested (automatic via CODEOWNERS)
- [ ] Negative test added
