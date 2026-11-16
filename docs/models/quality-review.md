# Deviation quality review (third-party model files)

- **Status:** proposal. The threshold below needs the technical reviewer's approval before any
  result counts (open item in `contracts/model-catalogue/v1/spec.md`, section 7).
- **Applies to:** every catalogue entry with `pipeline: "third-party"`. Its `deviation_review`
  records the reviewer, the date and `quality_threshold_result` (`pass` or `fail`). A `fail` entry
  is not published, and the app refuses to install it.

## What the review decides

The preferred pipeline builds every model file ourselves from the original weights (MVP 9.6). A
third-party file skips that, so the review answers one question: **is this file a sound build of
the model it claims to be, and does it work in the app's conditions?**

It does not decide whether the model itself is good enough for AIOS. That is the model choice
(A-04). All models of this size make mistakes, such as wrong arithmetic or invented facts, and
this review does not fail a file for them. It fails a file when the file is wrong: a different
file, a damaged quantisation, a broken chat template, or behaviour well below what the model
should give.

## Stages

| Stage | Question | How | Pass |
| --- | --- | --- | --- |
| 1 File | Is it the file the catalogue names, with metadata that fits the entry? | Size and SHA-256 against the catalogue; GGUF header: quantisation type, trained context, chat template present | all checks |
| 2 Quantisation | Is the quantisation sound? | KL divergence of the shipped file's next-token predictions from the same publisher's Q8_0 file (same pinned revision, SHA-256 checked) on a fixed text | mean KLD <= 0.10 and same top token >= 85 % |
| 3 Behaviour | Does it work in the app's conditions? | 31 prompts through the backend's own engine launcher and the shipped llama.cpp build, with the app's system prompt, checked automatically | >= 80 % of counted items, every counted group >= 50 % |
| 4 Reviewer | Are the answers usable? | The reviewer reads all answers and scores the 8 open-writing items 0-2 | mean >= 1.5, no item scored 0 |

The reviewer records `pass` only if all four stages pass.

### Stage 2 in more detail

- **Reference:** the publisher's Q8_0 file from the same repository and revision (listed with its
  SHA-256 in `tools/bench/quality_references.json`). Q8_0 is close to lossless, so any large
  difference comes from the shipped file.
- **Text:** wikitext-2 test set (the standard llama.cpp measurement text, SHA-256 checked, not
  stored in the repo), first 100 chunks of 512 tokens.
- **Why these limits:** a normal Q4_K_M file is usually at 0.02-0.08 mean KL divergence and
  around 90 % same top token. A broken conversion or a damaged tensor gives several times that.
  The limits catch a bad file, not a normal Q4 loss.
- `llama-perplexity` is built from the same pinned llama.cpp source as the shipped engine.

### Stage 3 in more detail

- **Prompt set:** `tools/bench/quality_prompts.json`, synthetic content only.

  | Group | Items | Counted | What it checks |
  | --- | --- | --- | --- |
  | instructions | 6 | yes | format and length rules (bullets, one word, JSON, word limit) |
  | reasoning | 6 | yes | times, percentages, ordering, rounding up, simple rules |
  | documents | 6 | yes | answers from a memo or meeting notes; says so when the answer is not there |
  | drafting | 5 | yes | emails, customer reply, newsletter paragraph, notes to text |
  | languages | 6 | yes | Italian, German, French, Spanish: answers in the language asked |
  | honesty | 2 | no | made-up share price and made-up book; reported, not counted |

- **System prompt:** the app will send one with every request (M-07), but its text is not written
  yet. The review uses this draft, kept as short as possible:

  > You are the assistant in AIOS. Answer in the language of the question. Never invent facts,
  > names, numbers or sources; if you are not sure, say so.

  (`draft-v3`; earlier drafts and their results are under Results.)

  Every prompt also runs without a system prompt, so the report shows what the instruction
  changes. When the app's final system prompt exists, stage 3 is run again with it.
- **Settings:** temperature 0, seed 42, at most 512 tokens, thinking off, one run per prompt.

## How to run

```
uv run python tools/bench/quality_review.py --entry <catalogue id> --model <file.gguf> \
    --reference <publisher's Q8_0.gguf> --text <wiki.test.raw>
```

- `llama-perplexity` comes from the pinned llama.cpp source (`build/out/llama-work/src`); pass it
  with `--perplexity-bin` if it is not at the default path.
- The output goes to `docs/models/quality-review/<entry>.md` (for the reviewer) and `<entry>.json`
  (everything).
- After a change to a check in the prompt set, `--recheck` re-scores the saved answers without
  running the model again. Any such change is listed under Changes below.

## Sign-off

1. Run the review for each third-party entry and commit both report files.
2. The reviewer reads the answers, fills in the stage 4 scores and decides `pass` or `fail`.
3. The reviewer's name, the date and the result go into the entry's `deviation_review`, in the same
   pull request as the reports.

## Results

Run on 2026-11-12, Linux x86_64. Stage 3 on the shipped CPU build (llama.cpp b12111), stage 2 with
`llama-perplexity` built from the same source with CUDA. Reports: `docs/models/quality-review/`.

| Entry | 1 File | 2 Quantisation | 3 Behaviour, `draft-v3` | 4 Reviewer | Result |
| --- | --- | --- | --- | --- | --- |
| `minicpm5-2b-q4_k_m-openbmb-gguf` | pass | pass: mean KLD 0.072, same top 86.7 % (PPL 16.05 vs 15.28) | pass: 26 / 29 (90 %) | pass: mean 1.50 (proposed by Andrea Rossetti) | pending reviewer |
| `ornith-1.5-9b-q4_k_m-ornith-gguf` | pass | pass: mean KLD 0.041, same top 92.2 % (PPL 9.36 vs 9.25) | pass: 28 / 29 (97 %) | pass: mean 1.75 (proposed by Andrea Rossetti) | pending reviewer |

Both files pass every automatic stage. MiniCPM is closer to the stage 2 limit, as expected for a
small model at Q4. Its remaining failures are ordinary model mistakes (wrong ordering, minutes in a
day, a dropped "Saturday"), not signs of a broken file.

### System prompt variants (stage 3 counted items, and honesty)

| System prompt | MiniCPM5 2B | Ornith 1.5 9B |
| --- | --- | --- |
| none | 83 %, honesty 1 / 2 | 93 %, honesty 1 / 2 |
| `draft-v1`: "... If you do not know something, or it is not in the text you were given, say so. Never invent names, numbers or sources." | 83 %, honesty 2 / 2 | 93 %, honesty 2 / 2; refuses a general question (IF-1) because "no text was provided" |
| `draft-v2`: "... Never invent names, numbers or sources: if you do not know something, say so. When you are given a text, answer from it and say when something is not in it." | 90 %, honesty 2 / 2 | 93 %, honesty 2 / 2; same IF-1 refusal |
| `draft-v3`: "... Never invent facts, names, numbers or sources; if you are not sure, say so." | 90 %, honesty 1 / 2 | 97 %, honesty 1 / 2 |

- Without a system prompt, both models invent an author for a made-up novel. "If you do not know
  something, say so" stops that in both. "If you are not sure, say so" does not.
- Any mention of "a text you were given" makes Ornith refuse questions that come with no text.
  Neither model needs that clause: both answer "not in the memo" correctly without it (SU-4).
- Two honesty prompts are too few to choose the app's system prompt. The wording is decided with
  the chat work, on a larger set; stage 3 is then run again with it. The stage 1-3 results above
  pass with every variant, so the file review does not depend on that choice.

Stage 4 scores are proposals; the technical reviewer confirms or changes them and records the
result. They are stored in `docs/models/quality-review/<entry>.scores.json` and shown in each report.
MiniCPM's mean is exactly on the limit (1.50).

## Notes

- Stage 3 ran with the engine settings of 2026-11-12 (4,096-token context, default cache). Since
  then `main` starts the engine with a 16,384-token context, a q8_0 cache and flash attention. The
  file checks (stages 1 and 2) do not depend on this; stage 3 is run again with the new settings
  together with the app's final system prompt.
- `main` also added two large-tier third-party entries (`sage-a1.5-q4_k_m-mradermacher-gguf`,
  `qwen3.8-27b-ud-q4_k_m-unsloth-gguf`) with `deviation_review: null`. They need this review too.
- The MiniCPM file's own metadata names the model "MiniCPM5 2.6B"; the catalogue calls it
  "MiniCPM5 2B". To align when the model choice is settled.

## Changes

- v2: SU-4 also accepts "no specific name" (a correct answer was failed by the check).
- v3: system prompts added; the review restructured into the four stages above, and the honesty
  group no longer counts towards the threshold.
- v4, v5: system prompt `draft-v1` replaced by `draft-v2`, then `draft-v3` (see Results). The
  answers were regenerated each time (`--stage3-only`); stages 1 and 2 were not repeated.
