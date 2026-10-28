# A-04 — Model shortlist and provenance (decision record)

- **Status:** draft. The catalogue is unsigned, and no artefact has been built yet.
- **Date:** 2026-10-28
- **Scope:** the small and medium tiers from MVP 10.2, at Q4. Only Apache-2.0 models are eligible.
  Every entry must carry the full MVP 9.6 provenance.

Artefacts:

- `catalogue/catalogue.draft.json` and `catalogue/manifests/`
- `licenses/models/`
- `tools/catalogue/build_entry.py`

## 1. Decision

| Tier | Default (own pipeline) | Upstream @ revision | source_weights_digest | Fallback (third-party) |
|---|---|---|---|---|
| small | **Qwen3 4B, Q4_K_M** (`qwen3-4b-q4_k_m`) | `Qwen/Qwen3-4B` @ `1cfa9a7208912126459214e8b04321603b3df60c` | `cf184c46cb944158a4339c8b4b3a2334620d0f9b719d3f09737364816c1f8611` | `Qwen/Qwen3-4B-GGUF` @ `bc640142…` `Qwen3-4B-Q4_K_M.gguf`, 2,497,280,256 B, sha256 `7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5` |
| medium | **Qwen3 8B, Q4_K_M** (`qwen3-8b-q4_k_m`) | `Qwen/Qwen3-8B` @ `b968826d9c46dd6066d109eabc6255188de91218` | `8f51132290852a4ab4070da7e075f9a6e14f2e14553663e25211fdd99c170222` | `Qwen/Qwen3-8B-GGUF` @ `7c41481f…` `Qwen3-8B-Q4_K_M.gguf`, 5,027,783,488 B, sha256 `d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785` |

Settings shared by both default entries:

- **Conversion:** llama.cpp `convert_hf_to_gguf.py` (to BF16), then `llama-quantize` (to Q4_K_M).
- **llama.cpp version:** release **b11960**, commit `8642541b255bfb5dc39cd351a178be09013a55d6`, as
  pinned in `build/llama/manifest.json` by B-02.
- **Publisher:** AIOS.
- **Native context:** 32,768 tokens, per the model card. YaRN can extend this to 131k, but we do not
  enable it. `config.json` sets `max_position_embeddings` to 40,960; the card explains that this
  covers a 32k output plus an 8k prompt.
- **min_ram_gb:** 8 for small and 16 for medium. These are our sizing estimates from the Q4_K_M file
  sizes (about 2.5 GB and 5.0 GB) plus KV cache and OS headroom. They have **not** been measured on
  pilot hardware.

### Revisions, sizes and digests

All revisions, file sizes and per-file sha256 values were read from the Hugging Face API on
2026-10-28:

- `https://huggingface.co/api/models/<repo>` gives the `sha` field.
- `https://huggingface.co/api/models/<repo>/tree/<sha>` gives the LFS `oid` for each file.

The tree at each pinned sha was identical to the tree at `main` on that date.

`source_weights_digest` is the sha256 of the committed manifest file
(`catalogue/manifests/<model>.safetensors.sha256`). The manifest has one line per `*.safetensors`
file, each formatted `<sha256>  <filename>\n` and sorted by filename. We computed the digest from the
Hub's LFS hashes without downloading the weights. `build_entry.py` recomputes it from the downloaded
bytes before converting.

### Why Qwen3 rather than a newer Qwen

Qwen has published newer small models since Qwen3:

- `Qwen/Qwen3.5-4B` @ `851bf6e8…`, Apache-2.0, published 2026-02.
- `Qwen/Qwen3.5-9B` @ `c2022362…`, Apache-2.0, published 2026-02.

Both are tagged `image-text-to-text` (vision-language). The 9B model is outside the "8B-class"
wording of MVP 10.2. As of 2026-10-28, Qwen 3.6 and 3.8 have no 4B or 8B dense text model on the
Hub. Qwen3.5-4B and Qwen3.5-9B are valid **next candidates** under the same licence rule. We have not
evaluated them, and we have not checked llama.cpp b11960's support for their architecture.

Qwen3 4B and 8B stay as the defaults because they are text-only, well supported by llama.cpp, and
have official Qwen Q4_K_M GGUFs available as fallbacks.

`Qwen/Qwen3-4B-Instruct-2507` is a non-thinking refresh of the 4B model. It has no 8B sibling, so
we keep the matched Qwen3 pair.

## 2. Licence findings

| Model | Licence | Eligible? | Source |
|---|---|---|---|
| Qwen3-4B / Qwen3-8B | Apache-2.0 (full text in repo, "Copyright 2024 Alibaba Cloud") | **Yes** | https://huggingface.co/Qwen/Qwen3-4B/blob/main/LICENSE, https://huggingface.co/Qwen/Qwen3-8B/blob/main/LICENSE |
| Qwen3-4B-GGUF / Qwen3-8B-GGUF | Apache-2.0 ("Copyright 2025 Alibaba Cloud") | Yes, but third-party artefact; needs a deviation review | https://huggingface.co/Qwen/Qwen3-4B-GGUF/blob/main/LICENSE |
| Qwen3.5-4B / Qwen3.5-9B | Apache-2.0 (HF card metadata + LICENSE file present) | Yes (candidate, not evaluated) | https://huggingface.co/Qwen/Qwen3.5-4B/blob/main/LICENSE |
| **Gemma 4** (E2B, E4B, 12B, 26B-A4B, 31B) | **Apache-2.0** | Yes (candidate, not added) | See below |
| **Llama 4** (Scout, Maverick) | Llama 4 Community License (HF card: `license: other`, `license_name: llama4`; gated) | **No** | https://huggingface.co/meta-llama/Llama-4-Scout-17B-16E-Instruct |

### Gemma 4

Gemma 4 **is Apache-2.0**. Gemma 1 to 3n stay under the Gemma Terms of Use. The evidence:

- Google Open Source Blog, 2026-04-02, "Gemma 4: Expanding the Gemmaverse with Apache 2.0": *"Gemma 4
  models are the first in the Gemmaverse to be released under the OSI-approved Apache 2.0 license."*
  https://opensource.googleblog.com/2026/03/gemma-4-expanding-the-gemmaverse-with-apache-20.html
- https://ai.google.dev/gemma/docs/gemma_4_license (last updated 2026-04-01) is the Apache License 2.0
  text. The page now says it is deprecated in favour of gemma.ai.
- The Gemma Terms of Use (https://ai.google.dev/gemma/terms, modified 2026-04-01) apply only to the
  models in its appendix. They say *"For Gemma 4 terms, see the Gemma 4 license."*
- The Hugging Face cards for `google/gemma-4-E4B-it` (@ `ee0ef602…`) and `google/gemma-4-12B-it`
  (@ `707f0a3b…`) carry `license: apache-2.0`. The repos are not gated.

There are two caveats:

1. The Gemma 4 HF repos contain **no LICENSE file**. The card links to the ai.google.dev page instead.
2. ai.google.dev also lists a "Prohibited use" policy and an "Intended use statement" under Legal.
   We have **not verified** whether either is binding for Gemma 4 or only advisory.

Legal (A-02 or counsel) should confirm the second point before Gemma 4 ships.

Gemma 4 E4B (small) and 12B (medium) are therefore **eligible candidates**. They are not in the
draft catalogue because:

- the ticket keeps Qwen3 as the default;
- they are multimodal ("any-to-any") models that we have not evaluated;
- llama.cpp b11960 support for them has not been checked.

If one is added, it needs its own licence file under `licenses/models/`, using the Apache-2.0 text
from the Gemma 4 licence page.

### Why Llama 4 is excluded

The catalogue admits Apache-2.0 models only. Llama 4 is distributed under the **Llama 4 Community
License Agreement**, a custom licence that is not Apache-2.0. The HF metadata for
`meta-llama/Llama-4-Scout-17B-16E-Instruct` is `license: other`, `license_name: llama4`, gated
`manual`. The licence rule alone excludes it.

(From memory and not re-verified today: the licence also requires "Built with Llama" attribution
and a separate licence above 700M monthly active users. Those terms are not needed to justify the
exclusion.)

## 3. Own pipeline vs third-party

Policy is to prefer our own quantisation, so both defaults are `pipeline: "own"`.

Each tier also has a **fallback** entry: the official Qwen Q4_K_M GGUF. It is `pipeline:
"third-party"` with publisher Qwen, and its sha256 and size are real values from the Hub. It carries
a deviation-review stub:

```json
{"reviewer": "TBD (technical reviewer, A-02)", "date": null, "quality_threshold_result": "pending"}
```

**No review has taken place, and no quality result exists.** A fallback must not be shipped until a
named reviewer has recorded a date and a pass result against the quality threshold.

The fallback entries also have gaps that we cannot close from upstream information:

- **`source_weights_digest` is `null`.** Qwen does not say which base revision the GGUF came from. The
  GGUF repos were last modified 2025-05-21; the base repos were last modified 2025-07-26.
- **The conversion version is "unknown — not stated in upstream repo".**

These gaps are part of what the deviation review must accept or reject.

## 4. Complete vs open

**Done:**

- Model choice, upstream repos and pinned revisions.
- Source-weight manifests and digests, computed from Hub LFS hashes and not yet re-verified from
  downloaded bytes.
- Conversion tool and version (b11960), and the quantisation method.
- Licence SPDX ids and filed texts.
- Publisher and pipeline.
- Fallback artefact digests and sizes.
- `build_entry.py` (ruff-clean; never run end-to-end).

**Open:**

1. **Run the pipeline** (`tools/catalogue/build_entry.py`) for both own entries. This fills
   `artefact.sha256` and `artefact.size_bytes`, which are `null` until then. It needs about 16 GB of
   downloads for 8B, plus disk space for the BF16 intermediates. It also needs a llama.cpp **source**
   checkout at commit `8642541b`, because the release zips have no `convert_hf_to_gguf.py`, and the
   Python requirements for convert.
2. **Quality check** of our own Q4_K_M against the threshold. It is not formally needed for own-pipeline
   entries, but it is advisable.
3. **Real mirror host** from B-06. `mirror_url` currently uses `https://models.example.eu/…`.
4. **Signing** and `issued_at`. The draft is unsigned.
5. **Deviation review**, only if a fallback is used. It needs a named reviewer, a date and a
   quality-threshold result.
6. **Validate the draft against `contracts/model-catalogue/v1`** once that contract lands. The draft
   uses the agreed field names, but it was written before the schema existed.
7. **Measure `min_ram_gb`** on pilot hardware.
8. **Legal confirmation** of the Gemma 4 ancillary policies, if Gemma 4 is ever added.

## 5. Acceptance checklist

| Criterion | Status |
|---|---|
| At least one small-tier and one medium-tier entry with every MVP 9.6 field filled | **Partially met.** `qwen3-4b-q4_k_m` (small) and `qwen3-8b-q4_k_m` (medium) have upstream model and revision, source-weight digest, conversion tool and version, quantisation method, licence reference, publisher and pipeline. The **artefact digest** is `null` until the pipeline runs. The third-party fallbacks do have an artefact digest, but they lack `source_weights_digest` and a passed review. The criterion becomes fully met after one run of `build_entry.py` per entry. |
| Any third-party artefact has a named deviation review with a quality-threshold result | **Not met (by design).** No third-party artefact is selected for shipping. The two fallback entries carry review stubs (`reviewer: "TBD (technical reviewer, A-02)"`, `quality_threshold_result: "pending"`). If a fallback is chosen, the review must be done first. |
| Licence texts in the repo | **Met.** All four upstream LICENSE files are in `licenses/models/`, verbatim, with a mapping in `licenses/README.md`. |
