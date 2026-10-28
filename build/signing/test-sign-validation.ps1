# A-01: sign a throwaway test executable and record the result.
#
#   powershell -File build/signing/test-sign-validation.ps1 -Publisher "Exact Legal Entity Name"
#
# 1. Compiles a tiny console exe (aios-signing-test.exe) with the C# compiler built into Windows.
# 2. Signs it with build/signing/sign.ps1 (Azure Artifact Signing; needs the same AIOS_SIGN_* and
#    AZURE_* variables as the release job, set in this terminal only, never written to a file).
# 3. Checks the signature and that the signer name matches -Publisher.
# 4. Writes build/out/signing-test/result.json, to be copied into docs/signing/A-01-validation.md.
#
# The SmartScreen check is manual and separate (see docs/signing/A-01-validation.md): copy the exe
# to a clean Windows 11 VM, download it through a browser as a STANDARD user, and run it.
param(
  [Parameter(Mandatory = $true)][string]$Publisher,
  [switch]$SkipSign          # only build + check (shows "NotSigned"; useful to test the script itself)
)
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$out = Join-Path $root "build\out\signing-test"
New-Item -ItemType Directory -Force $out | Out-Null
$exe = Join-Path $out "aios-signing-test.exe"
Remove-Item $exe -ErrorAction SilentlyContinue

Add-Type -OutputAssembly $exe -OutputType ConsoleApplication -TypeDefinition @"
public static class Program {
  public static int Main() {
    System.Console.WriteLine("AIOS signing test binary (A-01). Safe to delete.");
    return 0;
  }
}
"@

if (-not $SkipSign) { & powershell -NoProfile -File (Join-Path $PSScriptRoot "sign.ps1") $exe; if ($LASTEXITCODE -ne 0) { throw "signing failed" } }

$sig = Get-AuthenticodeSignature -FilePath $exe
$subject = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { "" }
$cn = if ($subject -match 'CN="?([^",]+)') { $Matches[1] } else { "" }
$o = if ($subject -match '(?:^|, )O="?([^",]+)') { $Matches[1] } else { "" }
$result = [ordered]@{
  date             = (Get-Date).ToString("yyyy-MM-dd HH:mm")
  file             = "aios-signing-test.exe"
  sha256           = (Get-FileHash $exe -Algorithm SHA256).Hash.ToLower()
  signature_status = "$($sig.Status)"
  signer_subject   = $subject
  signer_issuer    = if ($sig.SignerCertificate) { $sig.SignerCertificate.Issuer } else { "" }
  timestamped      = [bool]$sig.TimeStamperCertificate
  expected_publisher = $Publisher
  publisher_matches  = ($cn -eq $Publisher -or $o -eq $Publisher)
}
$result | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $out "result.json")
[pscustomobject]$result | Format-List | Out-String | Write-Host

if ($result.signature_status -ne "Valid") { throw "signature is not valid: $($result.signature_status)" }
if (-not $result.publisher_matches) { throw "signer '$subject' does not match the publisher '$Publisher'" }
Write-Host "PASS: valid signature from $Publisher. Now do the clean-VM / SmartScreen check by hand."
