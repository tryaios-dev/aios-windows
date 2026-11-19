# Company AI server (G-06): operator setup

AIOS can answer a conversation from the company's AI server instead of this computer. This is a
lab feature: it is **off in the pilot** and stays off until an operator switches it on on a
machine. Moving a conversation to Company always asks the person first, and every move is recorded
in Activity (invariant 2, PR-03).

The path is chat → provider router → gateway → `aios_backend/company.py` → the server, over HTTPS
through the network allowlist (only the one configured host is allowed).

## What the server must offer

- An OpenAI-compatible API: `GET /v1/models` and `POST /v1/chat/completions` with streaming
  (server-sent events). llama.cpp `llama-server` and vLLM both do.
- A required API key (`Authorization: Bearer <key>`). Requests without it must get 401.
- One HTTPS address on port 443 with a DNS name (not an IP address) and a certificate Windows
  trusts. No path after the host: AIOS adds `/v1/...` itself.
- In front of it: no browser login (AIOS calls it as an API), streaming not buffered, and long read
  timeouts (an answer can take minutes).
- `GET /v1/models` must list the model name given below (in llama-server: `--alias`).

## 1. The operator file

A JSON file with exactly these fields. Anything else (an API key in particular) makes AIOS refuse
the file and keep Company off.

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
| `company_model_name` | The id `GET /v1/models` lists. Letters, digits and `. _ : + -` only (it is recorded in Activity); for vLLM, serve the model under such a name with `--served-model-name` |
| `company_context_tokens` | Optional, default 16384: the context one conversation may use on the server (llama-server: `-c` divided by `-np`) |

Where it goes:

- **Installed app:** `%ProgramData%\AIOS\operator.json` (machine-wide, for every user of the
  computer). Create the folder as an administrator.
- **Development (`aios-backend serve`):** `services/backend/.dev/operator.json`.

The file is read when the backend starts: restart AIOS after changing it.

## 2. The API key

The key lives only in the OS key store (Windows Credential Manager, service `AIOS`, entry
`company-api-key`), never in a file, setting or environment variable (invariant 3). From a
development checkout, signed in as the Windows user who runs AIOS:

```powershell
uv run aios-backend company-key          # type or paste the key; it is not shown
```

or pipe it from the key file without displaying it:

```powershell
Get-Content $env:USERPROFILE\.aios-lab\company-key.txt -Raw | uv run aios-backend company-key
```

The key store is per Windows user: store the key once for each user who uses Company.
For an installed build without a development checkout, a key step in the installed app is still
to be added (see `docs/gap-log.md`).

## 3. Check

```powershell
uv run aios-backend company-check
```

`reachable: https://… model … context … tokens` means AIOS can use the server. Otherwise it prints
the reason:

| Reason | What to do |
| --- | --- |
| `Company AI is off` | The operator file is missing or refused: check its place and fields |
| `company_key_missing` | Store the key (step 2) as this Windows user |
| `company_key_rejected` | The server refused the key (401/403): store the current key |
| `company_model_not_listed` | `company_model_name` is not in the server's `/v1/models` |
| `company_unreachable` | No answer, an error status, or a redirect to another host: check the address, DNS, the proxy in front and whether the server runs |

The same reasons are written to the backend log as `company_failed` events (no content, no key).

## What people see

- The composer offers **Company** and Settings › Network shows the server as reachable.
- Moving a conversation (or a project's new conversations) to Company asks first.
- Answers use the Company prompt, not the "on this computer" one. Each answer's input commitment
  covers the exact messages sent, and token counts are the server's own.
- If the server stops answering, sending in a Company conversation answers `company_unreachable`;
  the person can move the conversation back to Local.

## Rotating the key

Rotate it on the server, then run step 2 again for every user. The old key stops working at once.
