# Licence texts

These are verbatim copies of the licence files published in each upstream repository at the pinned
revision. They were fetched from `https://huggingface.co/<repo>/raw/<revision>/LICENSE` on 2026-10-28.

| File | Upstream repo @ revision | Licence | sha256 of file | Catalogue entries |
|---|---|---|---|---|
| `models/Qwen3-4B-LICENSE.txt` | `Qwen/Qwen3-4B` @ `1cfa9a7208912126459214e8b04321603b3df60c` | Apache-2.0 ("Copyright 2024 Alibaba Cloud") | `832dd9e00a68dd83b3c3fb9f5588dad7dcf337a0db50f7d9483f310cd292e92e` | `qwen3-4b-q4_k_m` |
| `models/Qwen3-8B-LICENSE.txt` | `Qwen/Qwen3-8B` @ `b968826d9c46dd6066d109eabc6255188de91218` | Apache-2.0 ("Copyright 2024 Alibaba Cloud") | `832dd9e00a68dd83b3c3fb9f5588dad7dcf337a0db50f7d9483f310cd292e92e` | `qwen3-8b-q4_k_m` |
| `models/Qwen3-4B-GGUF-LICENSE.txt` | `Qwen/Qwen3-4B-GGUF` @ `bc640142c66e1fdd12af0bd68f40445458f3869b` | Apache-2.0 ("Copyright 2025 Alibaba Cloud", CRLF line endings) | `5de36594c10839788a8c589443a8ef9d8b8d17c65a1b5807206ae037fc36c6bd` | `qwen3-4b-q4_k_m-qwen-gguf` (fallback) |
| `models/Qwen3-8B-GGUF-LICENSE.txt` | `Qwen/Qwen3-8B-GGUF` @ `7c41481f57cb95916b40956ab2f0b139b296d974` | Apache-2.0 ("Copyright 2025 Alibaba Cloud", CRLF line endings) | `5de36594c10839788a8c589443a8ef9d8b8d17c65a1b5807206ae037fc36c6bd` | `qwen3-8b-q4_k_m-qwen-gguf` (fallback) |

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
