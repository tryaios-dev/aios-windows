# Post-build check (B-04): every PE file (.exe, .dll, .node) in the output must carry a valid
# Authenticode signature. Any unsigned or invalid file fails the job.
#   powershell -File build/signing/verify-signatures.ps1 apps/desktop/release
param([Parameter(Mandatory = $true)][string]$Folder)
$ErrorActionPreference = "Stop"

$files = Get-ChildItem -Path $Folder -Recurse -Include *.exe, *.dll, *.node -File
if ($files.Count -eq 0) { throw "no PE files found under $Folder" }

$bad = @()
foreach ($f in $files) {
  $sig = Get-AuthenticodeSignature -FilePath $f.FullName
  if ($sig.Status -ne "Valid") { $bad += "$($sig.Status)  $($f.FullName)" }
}

Write-Host "checked $($files.Count) PE file(s)"
if ($bad.Count -gt 0) {
  $bad | ForEach-Object { Write-Host "UNSIGNED $_" }
  throw "$($bad.Count) file(s) without a valid signature"
}
Write-Host "all signed"
