# AppContainer for the backend and helper processes: feasibility (L-04)

**Status:** note for Phase 1b planning · **Date:** 2026-11-12 · Not implemented in the MVP.

## Question

Can `backend.exe`, `evidence-writer.exe` and `llama-server.exe` run in a Windows AppContainer (or
a Low-integrity / restricted-token sandbox), so that a compromised child cannot read the user's
files or reach the network beyond what AIOS allows?

## What the processes need today

| Need | backend | evidence-writer | llama-server |
| --- | --- | --- | --- |
| Read/write `%LOCALAPPDATA%\AIOS\data` | yes | `evidence.db` only | no |
| Read model files (`…\AIOS\models`) | yes (verify, hash) | no | yes, read only |
| Windows Credential Manager (DPAPI-backed vault) | yes (`keyring`, `WinVaultKeyring`) | yes (signing seed) | no |
| Listen on loopback | yes | yes | yes |
| Outbound internet | mirror, update check, company server (allowlist) | no | no |
| Read files the user picks (import, restore, export target) | yes, through paths sent by Electron main | backup/restore paths | no |
| Start child processes in a Job Object | yes | no | no |
| Registry / WMI for hardware detection | yes (models app) | no | no |

## Findings

1. **llama-server**: a good fit. It needs read access to one model file, loopback listening and
   nothing else. An AppContainer profile with no capabilities, plus an ACL granting the
   container SID read access on the models folder, covers it. Loopback inside an AppContainer
   needs care, because the default is to block loopback to other processes. The *server* side
   is allowed to listen. The backend (outside the container) connecting in works, but this must
   be confirmed on Windows 11 23H2+ with Vulkan drivers. GPU access (Vulkan, DirectML) from an
   AppContainer generally works but is driver-dependent. **Main risk: GPU drivers.**
2. **evidence-writer**: feasible. It needs one folder (ACL for the container SID), loopback
   listening and the signing seed. The seed is the hard part: Credential Manager entries are
   per user and not visible inside an AppContainer. The fix is for the backend to read the seed
   and hand it over in the stdin handshake. That is a Process and IPC v1 change: an optional,
   versioned frame field, so it needs a contract revision.
3. **backend**: not feasible without a redesign. It needs:
   - the user's Credential Manager;
   - outbound HTTPS to configured hosts (AppContainer capability `internetClient` opens all
     hosts, so it adds nothing over the app-level allowlist);
   - user-chosen paths anywhere on disk (would need brokering through Electron main);
   - registry and WMI hardware queries;
   - Job Object management of its children.

   Each of these could be brokered, but together they amount to moving most of the backend's
   OS access into Electron main, which is not justified for Phase 1b.
4. **Packaging**: AppContainer profiles are created per user with `CreateAppContainerProfile`
   (no admin needed) and processes are started with `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES`.
   The PyInstaller one-folder layout works unchanged, but the folder ACLs must be set at first
   run, and removed by the uninstaller.
5. **Alternative, cheaper hardening** for the backend: run it with a restricted token and Low
   integrity, and keep Medium integrity only on the data folder. This blocks writes to most of
   the user profile but still allows reads, so it gives limited value. The bigger win in
   Phase 1b is OS-level egress control (Windows Firewall rules per executable), which the
   network-allowlist spec already plans.

## Recommendation

- Phase 1b: put **llama-server** in an AppContainer first (smallest surface, processes
  untrusted model files). Then the **evidence-writer**, after the Process and IPC contract
  gains an optional seed field in the handshake.
- Keep the **backend** outside, and add per-executable firewall rules that allow only the
  allowlisted hosts for `backend.exe` and block all outbound traffic for the other two.
- Spike before committing: start `llama-server.exe` in an AppContainer on the reference GPU
  machines (Intel iGPU, NVIDIA, AMD), with loopback and Vulkan. About two days.
