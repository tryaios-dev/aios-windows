# B-01 / B-02: protect `main` on GitHub (green CI + code-owner review required, no direct pushes).
#   powershell -File tools/github/apply-main-ruleset.ps1                 # default repo tryaios-dev/aios-windows
#   powershell -File tools/github/apply-main-ruleset.ps1 -Repo owner/name
# Needs: gh CLI logged in as a repository admin. On a PRIVATE repo, rulesets are enforced only on a paid
# plan (GitHub Team or higher for organisations); on the Free plan GitHub rejects this call.
# Re-running replaces the existing "protect-main" ruleset, so the JSON file stays the source of truth.
param([string]$Repo = "tryaios-dev/aios-windows")
$ErrorActionPreference = "Stop"
$json = Join-Path $PSScriptRoot "main-ruleset.json"

$existing = gh api "repos/$Repo/rulesets" --jq '.[] | select(.name == \"protect-main\") | .id'
if ($LASTEXITCODE -ne 0) { throw "could not list rulesets for $Repo (is gh logged in as an admin?)" }

if ($existing) {
  gh api --method PUT "repos/$Repo/rulesets/$existing" --input $json | Out-Null
} else {
  gh api --method POST "repos/$Repo/rulesets" --input $json | Out-Null
}
if ($LASTEXITCODE -ne 0) { throw "GitHub rejected the ruleset (a private repo needs GitHub Team or higher)" }
Write-Host "ruleset protect-main applied on $Repo"
