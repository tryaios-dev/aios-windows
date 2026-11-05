# Engine: llama-server (D-03)

The local inference engine is llama.cpp's `llama-server`, built from a pinned
release with one patch, in two variants:

| Installer path | Build | For |
|---|---|---|
| `llama\cpu\` | CPU backend, all x64 CPU variants (picked at runtime) | machines without a usable GPU |
| `llama\vulkan\` | CPU + Vulkan backends | NVIDIA, AMD and Intel GPUs, no CUDA install |

- **Pin:** `manifest.json` (tag `b12111`, commit `52e53a7`, patch SHA-256, Vulkan SDK
  version). Bumping it means re-applying the patch, re-running the engine tests and a new
  review (CODEOWNERS covers `build/`).
- **Patch:** `patches/0001-api-key-stdin.patch` (see below). `build.py` refuses to build if
  its SHA-256 differs from `manifest.json`.
- **Licence:** MIT, `licenses/third-party/llama.cpp-LICENSE.txt`, copied next to every binary.
- **Digests:** `build.py` writes `build/out/llama/manifest-<variant>.json` with the tag, the
  commit, the patch digest and the SHA-256 of every shipped file. CI and the release job keep
  them with the artefacts. Note: the release job signs the binaries after building, so these
  digests are of the unsigned files; recompute after signing before committing them for a
  release.
- **Build:** `pnpm build:llama` (= `uv run python build/llama/build.py [cpu] [vulkan]`) into
  `build/out/llama/<variant>/`, which `electron-builder.yml` and the signing step use. On
  Windows run it from a VS x64 developer shell with clang, ninja and git; the Vulkan variant
  needs the Vulkan SDK. A local build of both variants takes a while; CI builds them in
  parallel (`llama-windows` job) and `package-windows` uses those builds.

## Key delivery (M-19, SR-08)

Upstream llama-server takes its API key only from `--api-key` (command line),
`LLAMA_API_KEY` (environment) or `--api-key-file` (a file). M-19 forbids all
three. The patch adds `--api-key-stdin`: llama-server reads one key from the
first line of stdin at start-up, the same way `backend.exe` receives its
token. The flag itself carries no secret. The patch also removes a trace-level
log line that printed the last four characters of the key.

The backend derives the engine key from its own token, writes it to the
engine's stdin and closes the pipe. The engine is a child of the backend.

Proven by `tests/engine/test_engine.py` on the CPU and Vulkan builds, on Linux and
Windows, in every CI run (`llama-linux`, `llama-windows`):

| Rule | Test |
|---|---|
| Answers a prompt with the key | `test_answers_a_prompt_with_the_key` |
| Every API route rejects a missing or wrong key | `test_rejects_requests_without_the_key` |
| Key not in the command line or environment | `test_key_not_in_command_line_or_environment` |
| Key not written to disk | `test_key_not_on_disk` |
| Key not in the engine's output | `test_key_not_in_engine_output` |
| No key, no start | `test_refuses_to_start_without_a_key` |
| Loopback only | `test_listens_on_loopback_only` |
| `/slots` and web UI off | `test_slots_and_webui_are_off` |

L-01 runs the same checks on every merge request.

## Start-up flags (MVP 8, engine hardening)

The engine should see only the model file and the loopback socket.

```
llama-server -m <model.gguf> --host 127.0.0.1 --port <random> --api-key-stdin
             --offline --no-webui --no-slots --no-ui-mcp-proxy
             [-c <ctx>] [-ngl <layers>]
```

| Flag | Why |
|---|---|
| `--host 127.0.0.1` | Loopback only. Upstream also defaults to it; stated explicitly. |
| `--api-key-stdin` | Key delivery, above. |
| `--offline` | No model downloads; the engine never reaches the network. |
| `--no-webui` | Belt and braces: the UI is not compiled in (`LLAMA_BUILD_UI=OFF`). |
| `--no-slots` | Upstream enables `/slots` by default; it exposes prompt content. |
| `--no-ui-mcp-proxy` | No MCP proxy (off by default; stated explicitly). |

Never passed, and off by default: `--tools` (file read/write and shell
execution), `--agent`, `--mcp-servers-*`, `--connect` (peer-to-peer tunnel),
`--path`, `--media-path`, `--slot-save-path`, `--models-dir` (router mode),
`--props`, `--metrics`, `--lora-init-without-apply`, `-hf`/`--*-default`
(downloads), `--api-key`, `--api-key-file`, and `-lv` at trace level. The build
also leaves out HTTPS support (`LLAMA_OPENSSL=OFF`).

## Environment (the engine reads options from it)

Every llama-server option can also be set by an environment variable
(`LLAMA_ARG_TOOLS=all` would enable shell execution), and llama-server reads
`config.ini` from `%PROGRAMDATA%\llama.cpp\` and `%APPDATA%\llama.cpp\`. A
developer's own llama.cpp settings on the same machine would leak in. So the
backend starts the engine with a **minimal environment built from scratch**,
not a filtered copy of its own:

| Variable | Value |
|---|---|
| `SystemRoot` | from the system (Winsock does not start without it) |
| `PATH` | the engine's own folder; `%SystemRoot%\System32` |
| `TEMP`, `TMP` | a private folder under the data folder |

No `APPDATA`, no `PROGRAMDATA`, no `LLAMA_*`: neither config file is found and
no option comes from the environment. Command-line flags also override both.
`minimal_env()` in `tests/engine/test_engine.py` is the reference; the backend launcher
(`services/backend/aios_backend/engine/launcher.py`, used by the process manager)
implements it.

## Engine output

At the default verbosity llama-server logs timings and slot events, not
prompts or answers (checked by `test_key_not_in_engine_output` and by hand
with a marker prompt). Even so, the backend does not write engine output to
the log files: it records only exit codes and its own content-free events
(M-21).

## Question 12: llama-server's public `/health`

Upstream answers `GET /health` without a key, by design (`{"status":"ok"}`,
or 503 while loading). M-19 says requests without the token are rejected.

| Option | Cost | What it means |
|---|---|---|
| **A. Accept (recommended)** | none | Loopback-only liveness, no content and no model name. The UI never sees it: the backend probes it with the key and reports `engine` in its own `/health`. Recorded as a scoped exception to M-19's wording. |
| B. Patch it | ~3 lines in the patch | `/health` requires the key like everything else. Grows the security-relevant patch and its rebase cost. |

**Decision: pending the technical reviewer.** Record it here and in question
12, and D-02 freezes it in `contracts/process-ipc/v1/spec.md` (replacing draft
proposal P-1, which passed the key in an environment variable).
`test_health_is_the_only_public_endpoint` pins the current behaviour; it changes
if B is chosen.

## Still to do by hand

- Vulkan build answers a test prompt on the 16 GB NVIDIA machine; CPU build on
  the 8 GB CPU-only machine (CI runners have no GPU).
- Start both variants on the clean Windows 11 VM: proves the app-local Visual
  C++ runtime is enough.
- Reviewer: the patch, the flag set and question 12.
