# Restore drill on a clean device (M-02, AC-17, AC-18)

A manual drill on two Windows 11 VMs. It shows that a backup and its recovery key restore a store
on a clean device, that the evidence chain continues under a new key, and that a fork is
visible. The same flow runs automatically in
`services/backend/tests/test_evidence_writer.py::test_m02_restore_drill_continues_the_chain_and_reports_the_branch`.
This drill adds the real installer, the Windows Credential Manager and the UI.

Time needed: about 45 minutes. Record the results in the table at the end.

## Needs

- Two clean Windows 11 VMs (A and B) with no AIOS installed, plus a shared folder or USB stick.
- The release candidate installer, and a built `aios-verify` (it is installed with AIOS as
  `aios-verify.cmd`).
- A model is **not** needed. Projects and evidence work without one.

## Steps

### Device A: create data and a backup

1. Install AIOS and finish first run. Write down the recovery key shown once (36 characters).
2. Create a project `Before backup` (Internal) and a conversation in it.
3. Evidence: export a date range covering today to `A-before.zip`.
4. Close AIOS. Check that Task Manager shows no `AIOS`, `backend` or `evidence-writer` process.
5. Copy these files to a folder `backup\` on the shared drive:
   - `%LOCALAPPDATA%\AIOS\data\chats.db`
   - `%LOCALAPPDATA%\AIOS\data\evidence.db`
   - `%LOCALAPPDATA%\AIOS\recovery.pkg`
6. Start AIOS again and create a project `After backup` (Public). Device A keeps working.
7. Export the evidence again, to `A-after.zip`.

### Device B: restore

8. Install AIOS. On the welcome screen choose **Restore from a backup**, pick `backup\` and
   enter the recovery key.
9. Expected: the app opens with the `Before backup` project and its conversation, but not
   `After backup`. The restore reports epoch 2.
10. Check that the Credential Manager now has the AIOS entries (Control Panel > Credential
    Manager > Windows Credentials). They hold the database key and a **new** signing key.
11. Create a project `On B` and export the evidence to `B.zip`.

### Negative checks (on a third clean VM, or after uninstalling B with "remove data" = Yes)

12. Type a wrong recovery key. Expected: "Wrong recovery key, or the package is damaged", and
    nothing changed.
13. Remove `evidence.db` from a copy of `backup\`. Expected: refused, "The backup is
    incomplete" (`r_missing_file`).
14. Flip one byte in the middle of `evidence.db` in a copy. Expected: refused (evidence log
    damaged, `r_evidence_invalid`).

### Verify

15. `aios-verify A-before.zip`. Expected: `intact`.
16. `aios-verify B.zip`. Expected: `intact`. It shows two signer keys: epoch 1, then epoch 2
    after the `continuation` event, with the handover checkpoint signed by the epoch-1 key.
17. `aios-verify A-after.zip B.zip`. Expected: `branched`, splitting after the seq of the backup
    tip. This is the visible fork (AC-18). Device A kept writing with the old key after the
    backup.
18. `aios-verify B.zip --expect-key <epoch-1 key_id of A>`. Expected: no `unknown_signer`.

## Results

| Step | Expected | Result | Notes |
| --- | --- | --- | --- |
| 9 | Before-backup data present, After-backup absent, epoch 2 | | |
| 10 | Keys in Credential Manager | | |
| 12 | Wrong key refused, nothing changed | | |
| 13 | Missing file refused | | |
| 14 | Damaged evidence refused | | |
| 15 | `intact` | | |
| 16 | `intact`, two signers | | |
| 17 | `branched` at the backup tip | | |
| 18 | trust anchor matches | | |

Drill run by: ______  Date: ______  Build: ______
