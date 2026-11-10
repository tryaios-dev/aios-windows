# Note for the product owner: local answer speed and model loading

From: Andrea (backend), 2026-11-06. Source: the D-04 spike runs on a clean Windows 11 VM
(`docs/spike-D04.md`). Asked for by the technical reviewer.

Correction, same day: the first VM figures (about 4 words per second, about 65 s to load) were
taken while Windows used only one of the VM's four cores, because of a VM setting. The figures
below are with four cores.

## 1. Speed on a small machine meets the target

| | Measured | Target (MVP 10.2) |
| --- | --- | --- |
| Qwen3-4B Q4_K_M (current small tier), CPU only, 8 GB VM with 4 cores | about 9 words per second | 5–15 words per second |
| MiniCPM5-2B Q4_K_M (catalogue v3 pick for 8 GB, no GPU), same VM | about 15 words per second | 5–15 |
| Qwen3-4B, CPU, developer laptop (i9-12900H) | about 9 words per second | 5–15 |
| Qwen3-4B, laptop GPU (RTX 3070 Ti, Vulkan) | about 63 words per second | — |

Both models meet the target on the 8 GB VM. MiniCPM5-2B is about 1.7× faster and its file is
smaller (1.6 GB against 2.5 GB), which leaves more memory free on an 8 GB machine; a long answer
(512 tokens) takes about 26 s against 45 s.

The VM is a stand-in for the 8 GB CPU-only fleet machine; the real fleet figures are still to
come. An older laptop with slower memory may be slower than the VM.

**Decision needed:** which model the small tier recommends for 8 GB machines without a GPU:
Qwen3-4B (meets the target) or MiniCPM5-2B (faster, smaller, catalogue v3 pick). The answer
quality of both still needs a short check with typical user questions.

## 2. The first answer waits for the model to load

On the VM with four cores the first question waited about 8 seconds while Qwen3-4B loaded (the
file was already in the disk cache; the first load after a restart can take longer). The same
wait happens again after the engine is unloaded when idle (5 minutes without use, to give memory
back). On the developer laptop loading takes about 1–4 seconds.

**Needed in the chat screen:** a visible "Loading the model…" state while the engine starts, so
the user does not think the app is stuck. The backend already reports it (`/health` → `engine:
"starting"`), and the app screens now show it.

**Decision needed:** is 5 minutes the right idle time before unloading? Longer keeps answers fast
after a pause but holds 2–4 GB of memory.
