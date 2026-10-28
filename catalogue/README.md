# Model catalogue (draft)

`catalogue.draft.json` is the **unsigned draft** of the model catalogue produced by task A-04.
Field names follow `contracts/model-catalogue/v1` (owned by the contracts task). Decision record:
[`docs/models/A-04-shortlist.md`](../docs/models/A-04-shortlist.md).

## Entries

| id | tier | pipeline | status |
|---|---|---|---|
| `qwen3-4b-q4_k_m` | small | own | provenance complete; artefact digest pending a pipeline run |
| `qwen3-8b-q4_k_m` | medium | own | provenance complete; artefact digest pending a pipeline run |
| `qwen3-4b-q4_k_m-qwen-gguf` | small | third-party (fallback) | not shippable until the deviation review passes |
| `qwen3-8b-q4_k_m-qwen-gguf` | medium | third-party (fallback) | not shippable until the deviation review passes |

## Why `artefact.sha256` and `artefact.size_bytes` are `null` on own-pipeline entries

We prefer our own quantisation. The GGUF artefact does not exist until we run the pipeline, so
its digest and size cannot be known in advance, and we do not make them up.
`tools/catalogue/build_entry.py` fills them:

```
uv run python tools/catalogue/build_entry.py --entry-id qwen3-4b-q4_k_m \
    --llama-cpp-dir <llama.cpp source at commit 8642541b (b11960)> \
    --quantize-bin <llama-b11960 bin>/llama-quantize.exe \
    --llama-cpp-release b11960 --work-dir <scratch with ~30 GB free>
```

The script:

1. Checks that `build/llama/manifest.json` pins the same release.
2. Lists the upstream repo at the pinned revision and confirms the safetensors set matches the manifest.
3. Downloads the files and checks every one against its sha256.
4. Runs `convert_hf_to_gguf.py --outtype bf16` and then `llama-quantize … Q4_K_M`.
5. Writes `artefact.sha256`, `artefact.size_bytes` and `conversion.version` back into the entry.

The release zips in `build/llama` contain binaries only. `convert_hf_to_gguf.py` comes from the
llama.cpp source tree at the same commit.

## `source_weights_digest`

This is the SHA-256 of the manifest file in `manifests/`. Each line of the manifest is
`<sha256>  <filename>\n` (two spaces), with one line per `*.safetensors` file at the pinned
revision, **sorted by filename**. The per-file sha256 values are the Git LFS object ids that the
Hugging Face tree API reports (`/api/models/<repo>/tree/<revision>`). For LFS files, these are the
SHA-256 of the file content. To check a digest:

```
sha256sum catalogue/manifests/Qwen3-4B.safetensors.sha256   # == source_weights_digest
```

For third-party entries, `source_weights_digest` is `null`. Qwen does not say which base-model
revision its GGUF files were converted from, so the value cannot be stated.

## Placeholders still in the draft

- `mirror_url` uses the placeholder host `https://models.example.eu/`. B-06 supplies the real host.
- `issued_at` is `null` and the file is unsigned. Signing happens at release.
- The third-party `deviation_review` has reviewer `TBD (technical reviewer, A-02)`, date `null` and
  `quality_threshold_result: "pending"`. No review has been carried out.
