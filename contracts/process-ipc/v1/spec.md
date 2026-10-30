# Process and IPC Contract v1

| Item | Value |
| --- | --- |
| Version | 1 |
| Status | draft |
| Extension rule | Later versions add optional fields only; semantics never change. |
| Freezes | week 1, by ticket D-02 (golden vectors + `FROZEN`) |
| Owner of the code | Electron main (`apps/desktop/src/main/backend/`, `apps/desktop/src/main/ipc/`), backend (`packages/py/aios-common/src/aios_common/handshake.py`, `asgi_auth.py`, `services/backend/aios_backend/__main__.py`), evidence writer (start-up) |
| Schemas | `token-handshake.schema.json` (stdin frame), `ready-line.schema.json` (READY payload) |

## 1 Purpose

How the processes of one AIOS launch start each other, pass the per-launch secret, report
readiness and authenticate every local request. It is the basis of SR-08 / AC-10: the launch
token is generated in Electron main, travels only over a stdin pipe, and never appears in argv,
environment, logs or files.

## 2 Processes and who starts whom

| Parent | Child | Secret the child receives | Child serves |
| --- | --- | --- | --- |
| Electron main | `backend.exe` | launch token `T` | local API (bearer `T`), gateway (bearer `derive(T, gateway)`) |
| `backend.exe` | `evidence-writer.exe` | `derive(T, evidence-writer)` | writer API (bearer = that token) |
| `backend.exe` | `llama-server.exe` | `derive(T, engine)` | OpenAI-compatible engine (API key = that token) |

The renderer holds no token and reaches nothing directly; its only door is `window.aios`
(section 7). Every server binds `127.0.0.1` only.

## 3 Launch token

- Electron main: 32 bytes from `crypto.randomBytes`, encoded base64url without padding
  (`apps/desktop/src/main/backend/token.ts`). The token is therefore exactly 43 characters of
  `[A-Za-z0-9_-]`. One token per launch, held in memory only.
- The backend uses the token **as its ASCII string bytes** (it does not base64-decode it), both
  for bearer comparison and as the HMAC key in section 5.

## 4 Start-up handshake (Electron main → backend)

1. Main spawns `backend.exe` with `stdio = [pipe, pipe, inherit]`, no token in argv or env.
   Packaged builds pass only `SystemRoot` and `LOCALAPPDATA` in the environment.
2. Main writes **one frame** to the child's stdin and then closes stdin (`stdin.end(frame)`):
   the frame is one JSON object (UTF-8) followed by a single LF, valid against
   `token-handshake.schema.json`:
   `{"token": "<43 chars>", "api_port": 0}`
   - `token` required.
   - `api_port` optional, default 0. 0 = the backend picks a free loopback port.
3. Backend (`aios_common.handshake.read_handshake`) reads exactly one line, keeps the token in
   process memory, closes its stdin, then backs up and migrates `chats.db`, then starts serving.
4. Backend writes **one READY line** to stdout:
   `READY <json>` + LF, where `<json>` is valid against `ready-line.schema.json`, e.g.
   `READY {"api_port": 50123}`. The prefix is the 6 bytes `READY ` (with one space).
5. Main reads stdout line by line, ignores lines not starting with `READY `, parses the first
   READY line and builds its API client for `http://127.0.0.1:<api_port>`.

The same frame and READY shapes are used between the backend and `evidence-writer.exe`, with
`token = derive(T, evidence-writer)` (64 lowercase hex characters; see the schema's `oneOf`).

### READY payload

| Field | Type | Req. | Meaning |
| --- | --- | --- | --- |
| `api_port` | integer 1–65535 | yes | Port of the local API (writer: of the writer API) on 127.0.0.1 |
| `gateway_port` | integer 1–65535 | no | Port of the OpenAI-compatible gateway app (backend only; present once the gateway ships) |

Readers ignore unknown READY fields (later versions add optional fields only).

## 5 Derived tokens

`derive(T, purpose) = lowercase_hex( HMAC-SHA256( key = ASCII(T), msg = UTF-8(purpose_string) ) )`

64 hex characters. This is exactly `aios_common.handshake.derive`. Purpose strings for v1:

| purpose | purpose_string | Used by |
| --- | --- | --- |
| gateway | `aios/ipc/v1/gateway` | callers of the gateway app (the backend's provider router) |
| evidence-writer | `aios/ipc/v1/evidence-writer` | backend → writer requests |
| engine | `aios/ipc/v1/engine` | gateway → llama-server (`Authorization: Bearer`) |

A derived token cannot be turned back into `T` or into another purpose's token. Purpose strings
are part of the frozen contract.

## 6 Request authentication (every server)

Implemented once in `aios_common.asgi_auth.LoopbackTokenMiddleware`, before routing:

1. Client address not in `{127.0.0.1, ::1}` → `403 {"error": "forbidden"}`.
2. Header `Authorization` must be exactly `Bearer <token>` (scheme case-sensitive, one space),
   compared in constant time (`hmac.compare_digest`) with the token that server accepts.
   Otherwise → `401 {"error": "unauthorized"}`. No other information is returned.
3. Public paths that skip step 2 exist only in the dev profile (`/health`, `/docs`); the
   desktop profile has none.

## 7 Renderer ↔ main IPC

- The renderer reaches main only through `window.aios` (preload, `contextBridge`), typed by
  `packages/ts/bridge-contract`. Main registers exactly the channels in `Channels`
  (v1: `aios:invoke`).
- Main validates every call with the bridge-contract zod schema before calling the backend and
  never returns a token, port or backend error body to the renderer.

## 8 Rejection and failure rules

| Condition | Required behaviour |
| --- | --- |
| stdin frame missing, not one JSON line, invalid against the schema, or larger than 4096 bytes | Child exits non-zero before opening any database; prints no READY line |
| READY not seen within 30 s (`backend_start_timeout`) | Main reports start failure and kills the child |
| Child exits before READY (`backend_exit_<code>`) | Main reports start failure |
| Second READY line | Ignored by main |
| Anything other than the READY line on stdout | Not allowed from the child (diagnostics go to stderr / content-free log files); main ignores it |
| Token appears in argv, env, a log line or a file | Contract violation (AC-10 test) |

## 9 Known gaps between code and this draft (fix before D-02 freezes)

1. `read_handshake` does not validate the frame (no schema, no length limit, extra fields
   accepted). D-02 adds validation against `token-handshake.schema.json`.
2. `__main__.py` picks a port with `free_port()` (bind, release, re-bind: race) and prints READY
   **before** uvicorn has bound the socket, so main can connect too early. READY must be printed
   only after the listener is bound (e.g. from the uvicorn startup hook, using the bound port).
3. `gateway_port`, the writer and the engine are not started by the code yet.
4. Exit codes for handshake failure are not defined in code.

## 10 Spec check

- [ ] MVP 9.2 / Master 9.3: confirm the minimum content of the Process and IPC Contract against
  the spec text (field list, READY format, timeouts).
- [ ] SR-08, FR-30, AC-10: confirm wording on where the token may not appear.
- [ ] Confirm whether the spec fixes the 30 s start timeout and the engine start timeout.

## 11 Open questions — PROPOSED, confirm against open question list (1, 6–13)

- **P-1 Token transport to llama-server.** PROPOSED: `derive(T, engine)` is passed in the child
  environment variable `LLAMA_ARG_API_KEY` (not argv, which is visible in process listings and
  crash reports). It is per-launch, purpose-bound and only opens the loopback engine; the
  launch token itself never leaves the stdin pipe. Alternative: `--api-key-file` on a
  temporary file (rejected: invariant says no files).
- **P-2 Strict frame.** PROPOSED: `additionalProperties: false` for the stdin frame. Electron main
  and backend ship in one installer, so there is no mixed-version case; a later optional field
  is added to the schema in the same release.
- **P-3 READY tolerance.** PROPOSED: READY readers ignore unknown fields (forward compatible).
- **P-4 Port choice.** PROPOSED: Electron sends `api_port: 0`; the backend binds port 0 and
  reports the OS-assigned port.
- **P-5 Child lifetime.** PROPOSED: backend runs writer and engine inside a Windows Job Object
  with kill-on-close, so they die with the backend; main kills the backend on quit.
