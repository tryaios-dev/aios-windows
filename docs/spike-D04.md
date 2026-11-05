# D-04 inference spike (temporary, marker `SPIKE-D04`)

One local answer through the installed app before the gateway (G-01) and the chat service
exist. Proves installer → Electron → backend → llama-server → renderer on a clean machine
(M1), with the engine key delivered over stdin (D-03), and gives the week-1 benchmark.

## What is temporary

| Part | Path |
| --- | --- |
| Endpoint `POST /spike/v1/chat/completions` (OpenAI chunk format, streamed) | `services/backend/aios_backend/apps/spike/` |
| Router line | `services/backend/aios_backend/main.py` |
| Bridge call `window.aios.spike.ask` | `packages/ts/bridge-contract`, `apps/desktop/src/preload`, `apps/desktop/src/main/ipc/spike.ts` |
| Screen "Local answer (spike)" | `apps/ui/src/features/spike/`, route and sidebar link |
| Tests | `services/backend/tests/test_spike.py`, `apps/desktop/tests/unit/spike.test.ts` |

**Removal:** G-01 cannot close while `git grep SPIKE-D04` finds anything outside this file.

Not temporary: the engine launcher (`services/backend/aios_backend/engine/`), which the
process manager (D-05) builds on, and `tools/bench/engine_bench.py`.

## M1 check on a clean Windows 11 VM

1. Install `AIOS Setup <version>.exe` from the CI artifact `aios-windows-unsigned` as a
   standard user.
2. Copy the small-tier model into `%LOCALAPPDATA%\AIOS\models\`:
   `Qwen3-4B-Q4_K_M.gguf`, SHA-256 `7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5`
   (catalogue entry `qwen3-4b-q4_k_m-qwen-gguf`, `Qwen/Qwen3-4B-GGUF` @ `bc640142`).
3. Start AIOS, click through first run, open **Local answer (spike)**, ask.
4. Pass: an answer appears, with "First words after" and "Tokens per second".

## Benchmark

On each fleet machine, with the engine and model from the installed app:

```powershell
uv run python tools/bench/engine_bench.py --engine-dir "$env:LOCALAPPDATA\Programs\AIOS\resources\llama\cpu" `
    --model "$env:LOCALAPPDATA\AIOS\models\Qwen3-4B-Q4_K_M.gguf" --tier small --out bench.json
```

Use `resources\llama\vulkan` on the GPU machine. Targets: MVP 10.2 (small tier, CPU: about
5–15 words per second) and AC-04 (first words of a short answer within about 10 s on the
8 GB CPU-only machine). The screen shows the same two figures for one prompt.

| Machine | Engine | Model load | First words | Tokens/s | ≈ Words/s | Within targets |
| --- | --- | --- | --- | --- | --- | --- |
| 8 GB, CPU only | cpu | | | | | |
| 16 GB, NVIDIA | vulkan | | | | | |

Any change to the tier table goes to the product owner.
