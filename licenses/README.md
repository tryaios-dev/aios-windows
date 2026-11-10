# Licence texts

These are verbatim copies of the licence files published in each upstream repository at the pinned
revision. They were fetched from `https://huggingface.co/<repo>/raw/<revision>/LICENSE` on 2026-10-28.

| File | Upstream repo @ revision | Licence | sha256 of file | Catalogue entries |
|---|---|---|---|---|
| `models/Qwen3-4B-LICENSE.txt` | `Qwen/Qwen3-4B` @ `1cfa9a7208912126459214e8b04321603b3df60c` | Apache-2.0 ("Copyright 2024 Alibaba Cloud") | `832dd9e00a68dd83b3c3fb9f5588dad7dcf337a0db50f7d9483f310cd292e92e` | `qwen3-4b-q4_k_m` |
| `models/Qwen3-8B-LICENSE.txt` | `Qwen/Qwen3-8B` @ `b968826d9c46dd6066d109eabc6255188de91218` | Apache-2.0 ("Copyright 2024 Alibaba Cloud") | `832dd9e00a68dd83b3c3fb9f5588dad7dcf337a0db50f7d9483f310cd292e92e` | `qwen3-8b-q4_k_m` |
| `models/Qwen3-4B-GGUF-LICENSE.txt` | `Qwen/Qwen3-4B-GGUF` @ `bc640142c66e1fdd12af0bd68f40445458f3869b` | Apache-2.0 ("Copyright 2025 Alibaba Cloud", CRLF line endings) | `5de36594c10839788a8c589443a8ef9d8b8d17c65a1b5807206ae037fc36c6bd` | `qwen3-4b-q4_k_m-qwen-gguf` (fallback) |
| `models/Qwen3-8B-GGUF-LICENSE.txt` | `Qwen/Qwen3-8B-GGUF` @ `7c41481f57cb95916b40956ab2f0b139b296d974` | Apache-2.0 ("Copyright 2025 Alibaba Cloud", CRLF line endings) | `5de36594c10839788a8c589443a8ef9d8b8d17c65a1b5807206ae037fc36c6bd` | `qwen3-8b-q4_k_m-qwen-gguf` (fallback) |
| `models/MiniCPM5-2B-GGUF-LICENSE.txt` | `openbmb/MiniCPM5-2B-GGUF` @ `2079a22f3beaa4e306449978533478fe0522f4b3` | Apache-2.0 ("Copyright [OpenBMB]"). The Hugging Face repo has no licence file; its model card says Apache-2.0 and links to the licence in GitHub `OpenBMB/MiniCPM`, copied here from commit `f4293a1a7bde05d1acce99488235792615fc241b` on 2026-11-10 | `202d02b14796563546e1a1d1e761410fa9e399bf7e1b85d8b43c972658341202` | `minicpm5-2b-q4_k_m-openbmb-gguf` (small) |
| `models/Ornith-1.5-9B-GGUF-LICENSE.txt` | `ornith-ai/Ornith-1.5-9B-GGUF` @ `abdd624b12ebf020b767fff532ff44fe552b28c3` | MIT ("Copyright (c) 2026 deepreinforce.ai"). Neither Hugging Face repo has a licence file (the card's `license_link` is a 404); its model card says MIT. Text copied from GitHub `ornith-ai/Ornith-1` at commit `7ad11eb9ea871255fcf78006077a12a9843cf57a` on 2026-11-10. **Open:** ask Ornith for the licence file of the 1.5 weights | `ba0b4cc44cd824e63b2aa20691ab8707ed7407a91b3772d8ed47896d8c4d9629` | `ornith-1.5-9b-q4_k_m-ornith-gguf` (medium) |

The two Qwen3 base-repo files are byte-identical, and so are the two GGUF-repo files. The base and
GGUF texts differ only in the copyright year and the line endings. We keep one file per upstream
repo so each catalogue entry's `licence.reference` points at the exact text published with it.

## Redistribution notes (Apache-2.0 section 4)

When we ship a GGUF, we must also:

- ship a copy of the licence,
- state that we modified the files (conversion and quantisation count as changes), and
- keep any NOTICE file. None of the four upstream repos has a NOTICE file at the pinned revision.

The installer and the model download UI need to show the licence.

## Excluded

- **Llama 4**: the Llama 4 Community License is not Apache-2.0. See `docs/models/A-04-shortlist.md`.
- **Gemma 4** is Apache-2.0, but it is not in the catalogue yet. Its Hugging Face repos have no
  LICENSE file; the model card points to https://ai.google.dev/gemma/docs/gemma_4_license. If Gemma 4
  is added, file that Apache-2.0 text here.

## Bundled third-party binaries

| File | Upstream @ revision | Licence | Shipped in |
|---|---|---|---|
| `third-party/llama.cpp-LICENSE.txt` | `ggml-org/llama.cpp` @ `8642541b255bfb5dc39cd351a178be09013a55d6` (release b11960, `build/llama/manifest.json`) | MIT | installer: `resources/llama/` (CPU + Vulkan llama-server) |

The whole `licenses/` folder is copied into the installer as `resources/licenses/`
(`apps/desktop/electron-builder.yml`). The llama.cpp zips also carry `LICENSE-LLVM-OpenMP`, which ships next to the binaries.
