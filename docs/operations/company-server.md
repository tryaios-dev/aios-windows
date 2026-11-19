# Company AI server (G-06): operator setup

AIOS can answer a conversation from a company AI server instead of this computer: the lab GPU
server, or a hosted OpenAI-compatible API such as DeepSeek. This is a lab feature: it is **off in
the pilot** and stays off until it is set up on a machine. Moving a conversation to Company always
asks the person first, and every move is recorded in Activity (invariant 2, PR-03).

The path is chat → provider router → gateway → `aios_backend/company.py` → the server, over HTTPS
through the network allowlist (only the one configured host is allowed).

## What the server must offer

- An OpenAI-compatible API: `GET /models` and `POST /chat/completions` with streaming
  (server-sent events), under the address you configure. llama.cpp `llama-server`, vLLM and
  DeepSeek all do.
- A required API key (`Authorization: Bearer <key>`). Requests without it must get 401.
- One HTTPS address on port 443 with a DNS name (not an IP address) and a certificate Windows
  trusts.
- In front of it: no browser login (AIOS calls it as an API), streaming not buffered, and long read
  timeouts (an answer can take minutes).
- `GET /models` must list the model name you configure (in llama-server: `--alias`).

**The address.** With no path (`https://gpu-api.example.com`), AIOS uses `/v1/models` and
`/v1/chat/completions`, which every OpenAI-compatible server serves. With a path
(`https://proxy.example.com/openai/v1`), AIOS uses it as it is.

**The model name** may hold letters, digits and `. _ : + -` only (it is recorded in Activity). For
vLLM, serve the model under such a name with `--served-model-name`.

## 1. Where the server is: two ways

Neither file ever holds the key; a file with a key in it is refused.

| | `operator.json` (operator) | `company.json` (`aios-backend company set`) |
| --- | --- | --- |
| Who writes it | An administrator, by hand | The CLI, per Windows user |
| Installed app | `%ProgramData%\AIOS\operator.json` (machine-wide) | `company.json` in the user's AIOS data folder |
| Development | `services/backend/.dev/operator.json` | `services/backend/.dev/company.json` |
| Address | No path (AIOS adds `/v1`) | With or without a path |
| Changes | Read at start: restart AIOS | Followed while AIOS runs: no restart |

**When `operator.json` switches Company on, it decides** and `company.json` is not read: a
per-user file cannot override the operator's choice.

### operator.json

Exactly these fields; anything else keeps Company off.

```json
{
  "company_ai": true,
  "company_base_url": "https://gpu-api.example.com",
  "company_model_name": "gemma-4-26b-a4b",
  "company_context_tokens": 16384
}
```

| Field | Meaning |
| --- | --- |
| `company_ai` | `true` switches Company on for this computer |
| `company_base_url` | `https://` + DNS name, port 443, no path |
| `company_model_name` | The id `GET /v1/models` lists |
| `company_context_tokens` | Optional, default 16384: the context one conversation may use on the server (llama-server: `-c` divided by `-np`) |

### company.json, with the CLI

```powershell
uv run aios-backend company set                       # DeepSeek: asks only for the key
uv run aios-backend company set --url https://gpu-api.example.com --model gemma-4-26b-a4b --context 16384
```

It asks for the key (not shown), stores it (step 2), writes `company.json` and runs the check
(step 3; `--no-check` skips it). `--profile dev` writes the development file; the default is the
installed app's (`desktop`).

## 2. The API key

The key lives only in the OS key store (Windows Credential Manager, service `AIOS`, entry
`company-api-key`), never in a file, setting or environment variable (invariant 3). `company set`
stores it. To store or replace only the key, signed in as the Windows user who runs AIOS:

```powershell
uv run aios-backend company key          # type or paste the key; it is not shown
```

or pipe it from a key file without displaying it:

```powershell
Get-Content $env:USERPROFILE\.aios-lab\company-key.txt -Raw | uv run aios-backend company key
```

The key store is per Windows user: store the key once for each user who uses Company.
For an installed build without a development checkout, a key step in the installed app is still
to be added (see `docs/gap-log.md`).

## 3. Check

```powershell
uv run aios-backend company check                 # the installed app's setup
uv run aios-backend company check --profile dev   # the development setup
```

It asks the server for its model list (nothing is generated, so it costs nothing).
`reachable: https://… model … context … tokens (from operator.json)` means AIOS can use the
server, and says which file decided. Otherwise it prints the reason:

| Reason | What to do |
| --- | --- |
| `Company AI is off` | Neither file is there or valid: check its place and fields |
| `company_key_missing` | Store the key (step 2) as this Windows user |
| `company_key_rejected` | The server refused the key (401/403): store the current key |
| `company_model_not_listed` | The model name is not in the server's model list |
| `company_unreachable` | No answer, an error status, or a redirect to another host: check the address, DNS, the proxy in front and whether the server runs |

The same reasons are written to the backend log as `company_failed` events (no content, no key).

## What people see

- The composer offers **Company** and Settings › Network shows the server as reachable.
- Moving a conversation (or a project's new conversations) to Company asks first.
- Answers use the Company prompt, not the "on this computer" one. Each answer's input commitment
  covers the exact messages sent, and token counts are the server's own.
- If the server stops answering, sending in a Company conversation answers `company_unreachable`;
  the person can move the conversation back to Local.

## Switching it off

`uv run aios-backend company clear` removes `company.json` and the key. Delete `operator.json` (as
an administrator) to switch off an operator's setup, then restart AIOS.

## Rotating the key

Rotate it on the server, then run step 2 again for every user. The old key stops working at once.

## Before a hosted API is used with real data

A hosted API (for example DeepSeek) sends conversation content outside the company and possibly
outside the EU. It needs the legal decision recorded in `docs/gap-log.md` before it is used with
anything but test data.
