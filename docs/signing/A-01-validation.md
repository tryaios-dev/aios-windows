# A-01: code-signing validation record

Status: **open**. Fill in each section; the ticket closes when all four acceptance criteria below are ticked.
Two outcomes are recorded separately: a valid signature, and SmartScreen reputation. They are not the same thing.

## Acceptance criteria

- [ ] The publisher identity is confirmed in writing and the certificate or signing service is issued to it (section 1, 2).
- [ ] Windows reports a valid signature from the named publisher on the test binary, and it installs on a clean
      Windows 11 VM with no unknown-publisher warning (section 3, 4).
- [ ] Any SmartScreen reputation warning is recorded as a separate observation with a plan to clear it (section 5).
- [ ] The signing method and the account that holds it are recorded (section 2).

## 1. Publisher (legal entity)

| Item | Value |
| --- | --- |
| Legal entity name (exactly as on the certificate) | _TBD_ |
| Registration number / country | _TBD_ |
| Confirmed in writing by (name, role) | _TBD_ |
| Date and where the confirmation is filed | _TBD_ |

The publisher name on the signature is the legal entity, whatever the brand name is (the brand is "AIOS").
When confirmed, put the exact name in `apps/desktop/electron-builder.yml` → `win.signtoolOptions.publisherName`.
electron-updater refuses an update whose signer differs from that name.

## 2. Signing method and account

Master 18 accepts either option. The CI scripts (`build/signing/`, `.github/workflows/release.yml`) are written for option A.

| Option | What it is | Notes |
| --- | --- | --- |
| **A. Azure Artifact Signing** (formerly Trusted Signing) | Microsoft-managed signing service, certificate issued to the verified organisation, short-lived certs, no hardware | Identity validation of the organisation can take days to weeks; check the current eligibility rules (country, years of business history) before ordering. Works directly in GitHub Actions. |
| B. EV certificate in a hardware token or cloud HSM | Certificate from a CA (DigiCert, Sectigo, ...) | A USB token cannot be used from a GitHub-hosted runner: needs a cloud HSM (e.g. Azure Key Vault, DigiCert KeyLocker) or a self-hosted runner. Requires rewriting `build/signing/sign.ps1`. |

Since 2024 an EV certificate no longer gets instant SmartScreen reputation, so EV gives no reputation advantage over option A.

| Item | Value |
| --- | --- |
| Method chosen | _TBD (A or B)_ |
| Account / subscription that holds the credential | _TBD_ |
| Person responsible for the account | _TBD_ |
| Signing account name and certificate profile (option A) | _TBD_ |
| Endpoint region (option A) | _TBD_ |
| Date ordered / date issued | _TBD_ |

For B-04, the CI identity (an Entra app registration with the "Artifact Signing Certificate Profile Signer" role)
is stored as GitHub repository secrets: `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`,
`AIOS_SIGN_ENDPOINT`, `AIOS_SIGN_ACCOUNT`, `AIOS_SIGN_PROFILE`. Never in the repository.

## 3. Signature check on the test binary

Run on a machine with signtool and the Artifact Signing dlib installed, with the variables set in that terminal only:

```powershell
$env:AIOS_SIGNTOOL = "C:\Program Files (x86)\Windows Kits\10\bin\<version>\x64\signtool.exe"
$env:AIOS_SIGN_DLIB = "<path>\Microsoft.Trusted.Signing.Client\bin\x64\Azure.CodeSigning.Dlib.dll"
# plus AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AIOS_SIGN_ENDPOINT, AIOS_SIGN_ACCOUNT, AIOS_SIGN_PROFILE
powershell -File build/signing/test-sign-validation.ps1 -Publisher "<exact legal entity name>"
```

Paste `build/out/signing-test/result.json` here:

```json
TBD
```

## 4. Clean Windows 11 VM install (standard user)

| Step | Result |
| --- | --- |
| VM: fresh Windows 11 (edition, build), never used for development | _TBD_ |
| Logged in as a **standard** (non-admin) user | _TBD_ |
| Test exe downloaded through Edge (so it carries Mark of the Web), Properties → Digital Signatures shows the publisher | _TBD_ |
| Run: UAC / "unknown publisher" warning shown? (must be **no**) | _TBD_ |
| Signed installer (`AIOS Setup x.y.z.exe` from the release workflow) installs per-user without admin | _TBD_ |

## 5. SmartScreen reputation (separate observation)

| Item | Value |
| --- | --- |
| "Windows protected your PC" shown on first run? | _TBD_ |
| Screenshot filed at | _TBD_ |
| Plan to clear it | Reputation builds with installs of files signed by the same certificate identity. Plan: sign every pilot build with the same identity, distribute the internal pilot builds early, submit the installer at https://www.microsoft.com/wdsi/filesubmission as "software developer", re-check before M8. Switching framework (e.g. to Tauri) does not change reputation. |
