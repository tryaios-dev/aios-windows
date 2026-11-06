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
| CPU-fallback notice on that screen (D-06), until the chat notice (K-06) uses `/health` `engine_cpu_fallback`. Safe mode itself lives in Settings → Engine (not temporary) | `apps/ui/src/features/spike/SpikeScreen.tsx` |
| Tests | `services/backend/tests/test_spike.py`, `apps/desktop/tests/unit/spike.test.ts` |

**Removal:** G-01 cannot close while `git grep SPIKE-D04` finds anything outside this file.

Not temporary: the engine launcher and process manager (`services/backend/aios_backend/engine/`,
D-05) and `tools/bench/engine_bench.py`. The spike endpoint uses the process manager like the
gateway will.

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
| 8 GB, CPU only (fleet) | cpu | | | | | pending |
| 16 GB, NVIDIA (fleet) | vulkan | | | | | pending |
| *Reference:* clean Win 11 VM, 8 GB, 4 vCPU of an i9-12900H, installed app, spike screen | cpu | ~65 s (first question) | 1.5 s | 5.3 | ~4 | first words yes; speed just under 5 words/s |
| *Reference:* dev laptop i9-12900H, Linux, `engine_bench.py` | cpu | 3.6 s | 0.42 s | 12.2 | ~9 | yes |
| *Reference:* dev laptop, RTX 3070 Ti Laptop, Linux, `engine_bench.py` | vulkan | 7.7 s | 0.05 s | 84.5 | ~63 | yes |

Reference rows are not the fleet: they show the method works and give a first estimate. The
VM run (2026-11-05) also passed M1: installed `AIOS Setup 0.1.0.exe` (unsigned, CI build of
f924eb4), answer returned, no firewall prompt, no `llama-server.exe` left after closing the app.

Observed: the first question waits for the model to load (about a minute in the VM). The
chat screen should show that state (engine `starting` is in `/health`; the spike screen shows it).

Any change to the tier table goes to the product owner. The note with these findings: `docs/notes/2026-11-06-local-speed-and-model-loading.md`.

## Low-end comparison: MiniCPM5-2B against Qwen3-4B (2026-11-06)

Same clean Win 11 VM (8 GB, 4 vCPU, CPU build), installed app, spike screen, both models in the
same session with the host idle. MiniCPM5-2B is the catalogue v3 pick for "8 GB RAM, no dedicated
GPU". File: `openbmb/MiniCPM5-2B-GGUF` @ `2079a22f`, `MiniCPM5-2B-Q4_K_M.gguf`, 1,561,318,368
bytes, SHA-256 `ec2d5801640099e97d8d7e8003ad4d81f336e757811f03a26173dddf386602fd`.

| Model | File | First words (model loaded) | Tokens/s | ≈ Words/s | 512-token answer | Within 5–15 words/s |
| --- | --- | --- | --- | --- | --- | --- |
| MiniCPM5-2B Q4_K_M | 1.56 GB | 0.44–0.45 s | 8.3–9.3 | ~6.5 | 63 s | yes |
| Qwen3-4B Q4_K_M | 2.50 GB | 0.44–0.68 s | 4.4–5.3 | ~3.8 | 118 s | no |

On the dev laptop CPU (`engine_bench.py`): MiniCPM5-2B 27.0 tokens/s, load 0.8 s; Qwen3-4B
15.3 tokens/s, load 3.0 s. Load time on the VM (45–50 s for both) is not comparable yet:
MiniCPM5-2B ran first after install, while Windows Defender was still scanning the engine.
