# Note for the product owner: local answer speed and model loading

From: Andrea (backend), 2026-11-06. Source: the D-04 spike run on a clean Windows 11 VM
(`docs/spike-D04.md`). Asked for by the technical reviewer.

## 1. Speed is under the target on a small machine

| | Measured | Target (MVP 10.2) |
| --- | --- | --- |
| Small tier (Qwen3-4B Q4_K_M), CPU only, 8 GB VM with 4 cores | about 4 words per second | 5–15 words per second |
| Same model, CPU, developer laptop (i9-12900H) | about 9 words per second | 5–15 |
| Same model, laptop GPU (RTX 3070 Ti, Vulkan) | about 63 words per second | — |

The VM is a stand-in for the 8 GB CPU-only fleet machine; the real fleet figures are still to
come. If the fleet machine is as slow as the VM, the small tier misses the target on the weakest
supported hardware.

**Decision needed:** keep the target and the tier table, or change one. Options:
- accept about 4 words per second as the floor for 8 GB CPU-only machines;
- recommend a smaller model on those machines;
- raise the minimum hardware for the small tier.

## 2. The first answer waits for the model to load

On the VM the first question waited about 65 seconds while the model loaded into memory. The same
wait happens again after the engine is unloaded when idle (5 minutes without use, to give memory
back). On the developer laptop loading takes about 4 seconds, so the wait depends mostly on disk
and memory speed.

**Needed in the chat screen:** a visible "Loading the model…" state while the engine starts, so
the user does not think the app is stuck. The backend already reports it (`/health` → `engine:
"starting"`).

**Decision needed:** is 5 minutes the right idle time before unloading? Longer keeps answers fast
after a pause but holds 3–4 GB of memory.
