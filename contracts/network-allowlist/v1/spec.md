# Network Allowlist v1

| Item | Value |
| --- | --- |
| Version | 1 |
| Status | draft (hostnames are placeholders until B-06) |
| Extension rule | Later versions add optional fields only; semantics never change. |
| Freezes | fixed in the 1a build; frozen by ticket G-08 (golden vectors + `FROZEN`) |
| Owner of the code | Backend `services/backend/aios_backend/net.py` (the only module allowed to open outbound HTTP; a layout test enforces it); Electron main `apps/desktop/src/main/updater.ts` for the update feed |
| Files | `allowlist.json` (data), `allowlist.schema.json`, `golden-vectors/cases.json` (allow/deny decisions, G-08) |

## 1 Purpose

The complete list of outbound network flows AIOS may open in Phase 1a. Anything not listed is
refused. In Phase 1a this is an application-level control (no OS-level default-deny egress;
that arrives in Phase 1b). Loopback traffic between AIOS processes is not egress and is covered
by Process and IPC Contract v1.

## 2 Format

`{"version": 1, "flows": [ … ]}`; each flow:

| Field | Req. | Meaning |
| --- | --- | --- |
| `id` | yes | Stable flow name: `model-mirror`, `update-feed`, `company-server` in v1 |
| `host` | yes | Exact lowercase DNS name; or `configured` (company-server only: the one host from settings) |
| `port` | yes | TCP port |
| `scheme` | no (default `https`) | Only `https` in v1 |
| `client` | no | `backend-net` or `electron-updater`: which component opens it |
| `when` | yes | Human-readable trigger, checked in review and tests |

Placeholders `models.example.eu` and `updates.example.eu` are replaced by B-06 before G-08
freezes the list (the real hosts must also pass the corporate proxy).

## 3 Enforcement rules

1. A request is allowed only if scheme, host (exact, case-insensitive, after IDNA to ASCII) and
   port match one flow, and that flow's condition holds (e.g. company-server only when the lab
   flag is enabled **and** the user confirmed the disclosure for that request).
2. No IP literals, no wildcards, no subdomain matching.
3. Redirects are not followed automatically; each hop is checked against rule 1 (a mirror
   redirecting to a CDN host needs that host listed).
4. TLS certificate validation always on, using the Windows trust store (so a corporate
   TLS-inspection root installed by IT works); no pinning in v1.
5. Proxy: the Windows system proxy is used if configured; the allowlist applies to the target
   host, not the proxy.
6. A refused request fails closed and writes a content-free log line (flow id or the refused
   host and port; no URL path, query or body).
7. No telemetry, crash upload, analytics, font or CDN fetches exist; the renderer cannot open
   connections at all (CSP, no `fetch`).
8. The `configured` company host must be a DNS name (same rule as `host`), HTTPS, and is
   changed only in settings by the user.

Implementation notes (backend, `net.py`): redirects are followed by httpx, but every hop passes
the same check in a request hook before it is sent, at most 3 hops; certificates come from the
OS trust store via `truststore`. The decisions are pinned by `golden-vectors/cases.json`.

## 4 Rejection rules for the file

The build fails if `allowlist.json` is invalid against the schema, has duplicate `id`s, a host
not matching the rules, or a scheme other than `https`.

## 5 Spec check

- [ ] Master 9.3 / MVP 9.x (M-22): confirm the flow list, triggers and that the update feed is in
  scope of this contract.
- [ ] Confirm whether the model mirror may redirect to a separate download host.
- [ ] Confirm proxy authentication requirements with IT (A-02 contact).

## 6 Open questions — PROPOSED, confirm against open question list (1, 6–13)

- **P-1 Update feed client.** PROPOSED: in scope here although it runs in Electron main
  (electron-updater), not in backend `net/`; both enforce the same list.
- **P-2 Redirects.** PROPOSED: checked per hop; no automatic follow.
- **P-3 TLS and proxy.** PROPOSED: Windows trust store and system proxy; no certificate pinning
  in v1 (pinning breaks corporate TLS inspection).
- **P-4 Company server.** PROPOSED: one configured HTTPS host on port 443 (as listed), only with
  the lab flag and per-request confirmation (AC-15).
