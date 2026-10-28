# Signs every .exe and .dll under a folder with Azure Artifact Signing (B-04).
#   powershell -File build/signing/sign.ps1 build/out/backend
#
# No secrets in this file or in the repository. The CI job provides, as MASKED variables:
#   AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET   (read by the signing dlib itself)
#   AIOS_SIGN_ENDPOINT, AIOS_SIGN_ACCOUNT, AIOS_SIGN_PROFILE
#   AIOS_SIGNTOOL (path to signtool.exe), AIOS_SIGN_DLIB (path to Azure.CodeSigning.Dlib.dll)
# Nothing secret is echoed: only file names are printed.
param([Parameter(Mandatory = $true)][string]$Folder)   # a folder, or one file
$ErrorActionPreference = "Stop"

foreach ($name in "AIOS_SIGN_ENDPOINT", "AIOS_SIGN_ACCOUNT", "AIOS_SIGN_PROFILE", "AIOS_SIGNTOOL", "AIOS_SIGN_DLIB") {
  if (-not [Environment]::GetEnvironmentVariable($name)) { throw "missing CI variable $name" }
}

$metadata = Join-Path $env:TEMP "aios-sign-metadata.json"
@{ Endpoint = $env:AIOS_SIGN_ENDPOINT; CodeSigningAccountName = $env:AIOS_SIGN_ACCOUNT;
   CertificateProfileName = $env:AIOS_SIGN_PROFILE } | ConvertTo-Json | Set-Content -Encoding utf8 $metadata

try {
  $files = if (Test-Path $Folder -PathType Leaf) { @(Get-Item $Folder) }
           else { @(Get-ChildItem -Path $Folder -Recurse -Include *.exe, *.dll -File) }
  foreach ($f in $files) {
    Write-Host "sign $($f.FullName)"
    & $env:AIOS_SIGNTOOL sign /v /fd SHA256 /tr "http://timestamp.acs.microsoft.com" /td SHA256 `
      /dlib $env:AIOS_SIGN_DLIB /dmdf $metadata $f.FullName | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "signing failed: $($f.Name)" }
  }
  Write-Host "signed $($files.Count) file(s)"
} finally {
  Remove-Item $metadata -ErrorAction SilentlyContinue
}
