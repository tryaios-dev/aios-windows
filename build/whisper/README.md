# Voice engine: whisper-server (ADR 0016)

Speech to text runs in whisper.cpp's `whisper-server`, built from a pinned release with one
patch, in the same two variants as the chat engine (`build/llama/`):

| Build output | Build | For |
|---|---|---|
| `build/out/whisper/cpu/` | CPU backend, all x64 CPU variants (picked at runtime) | machines without a usable GPU |
| `build/out/whisper/vulkan/` | CPU + Vulkan backends | NVIDIA, AMD and Intel GPUs |

- **Pin:** `manifest.json` (release `v1.9.5`, commit `d1be6fd`, patch SHA-256, Vulkan SDK
  version). The ADR 0016 spike measured the ready-made build of the same commit (`b5454`).
  Bumping it means re-applying the patch, re-running the voice engine tests and a new review
  (CODEOWNERS covers `build/`).
- **Patch:** `patches/0001-api-key-stdin-and-routes.patch` (see below). `build.py` refuses to
  build if its SHA-256 differs from `manifest.json`.
- **Licence:** MIT, `licenses/third-party/whisper.cpp-LICENSE.txt`, copied next to every
  binary.
- **Digests:** `build.py` writes `build/out/whisper/manifest-<variant>.json` with the release,
  the commit, the patch digest and the SHA-256 of every shipped file (unsigned, as for llama).
- **Build:** `pnpm build:whisper` (= `uv run python build/whisper/build.py [cpu] [vulkan]`).
  Same toolchain as llama: on Windows a VS x64 developer shell with clang, ninja and git; the
  Vulkan variant needs the Vulkan SDK. The Visual C++ runtime is copied next to the binary: the
  spike showed the ready-made upstream build fails on a clean Windows 11 without it
  (0xC0000135). CI builds and tests every variant (`whisper-linux`, `whisper-windows`).
- **Installer:** `resources/whisper/{cpu,vulkan}/` (`electron-builder.yml`), next to
  `resources/llama/`. The model (`ggml-small-q5_1.bin`, 190 MB) goes in the models folder; the
  backend loads only the file with the SHA-256 pinned in `aios_backend/voice/manager.py`.

## The patch

Upstream `whisper-server` has no API key at all, loads any model file a request names
(`POST /load`), serves an HTML page and static files from `--public`, and sends
`Access-Control-Allow-Origin: *`. The patch:

| Change | Why |
|---|---|
| `--api-key-stdin`: one key from the first line of stdin; required, no key no start | M-19, SR-08: never argv, env or a file; same delivery as llama-server and backend.exe |
| Key checked on every route, `/health` included; 401 otherwise, constant-time compare | No public route, so no exception like llama's question 12 is needed |
| `POST /load` removed | It loaded any path it was given; the model is fixed at start-up (`-m`) |
| HTML page, static files and CORS removed | Only the backend calls the server |

The backend derives the voice key (`aios/ipc/v1/voice`, contract IPC-35) from its own token,
writes it to stdin and closes the pipe, as for the engine
(`services/backend/aios_backend/voice/launcher.py`).

Proven by `tests/voice/test_whisper_server.py` on every variant, Linux and Windows, in CI:

| Rule | Test |
|---|---|
| Transcribes with the key | `test_transcribes_with_the_key` |
| Every route rejects a missing or wrong key | `test_every_route_rejects_a_missing_or_wrong_key` |
| `/health` carries liveness only | `test_health_carries_liveness_only` |
| `/load`, the page and static files are gone | `test_load_page_and_static_files_are_gone` |
| No CORS headers | `test_no_cors_headers` |
| Loopback only | `test_listens_on_loopback_only` |
| Key not in the command line or environment | `test_key_not_in_command_line_or_environment` |
| Nothing written to disk (key, audio, text) | `test_nothing_written_to_disk` |
| Neither key nor transcribed text in the output | `test_neither_key_nor_text_in_output` |
| No key, no start | `test_refuses_to_start_without_a_key` |

The same tests fail against the unpatched upstream server.

## Start-up flags

```
whisper-server -m <ggml-small-q5_1.bin> --host 127.0.0.1 --port <random> --api-key-stdin
               -l auto -nt -t <threads>
```

Never passed: `--convert` (runs `ffmpeg` through the shell), `--public`, `--tmp-dir`,
`-pr`/`--print-realtime` (prints the text), `-debug`, `-tr`/`--translate`, `--dtw`, `-oved`.
The audio window (`audio_ctx`, the spike's `-ac`) is never set: Whisper always uses its full
30 s window. A window fitted to the phrase made the pinned build's text depend on the request
before it (the same phrase came back right, then as "... ... ..." or in English).

## Environment

As for llama-server, the backend starts it with a minimal environment built from scratch
(`SystemRoot`, `PATH` = its own folder and System32, a private `TEMP`/`TMP`). whisper-server
reads `WHISPER_ARG_DEVICE` from the environment; it is never set. `minimal_env()` in
`tests/voice/test_whisper_server.py` is the reference.

## Still to do by hand

- Start both variants on the clean Windows 11 VM: proves the app-local Visual C++ runtime is
  enough (the spike's failure).
- Reviewer: the patch and the flag set.
