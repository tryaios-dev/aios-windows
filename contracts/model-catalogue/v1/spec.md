# Model Catalogue v1

| Item | Value |
| --- | --- |
| Version | 1 |
| Status | draft |
| Extension rule | Later versions add optional fields only; semantics never change. |
| Freezes | week 4, by ticket I-01 (golden vectors + `FROZEN`) |
| Owner of the code | Backend catalogue app (`services/backend/src/aios_backend/apps/catalogue/`), signing tool `tools/catalogue/sign.py` |
| Schemas | `catalogue.schema.json` (`catalogue.json`), `signature.schema.json` (`catalogue.json.sig`) |

## 1 Purpose

The signed list of models AIOS may install. A model is installed only if its artefact matches
a catalogue entry byte for byte (size and SHA-256), and the entry records where the weights came
from, how they were converted and quantised, under which licence, and who reviewed third-party
artefacts.

## 2 Conventions

RFC 8785 JCS, integers only, SHA-256 lowercase hex, `H(tag, bytes) = SHA-256(UTF-8(tag) ‖ 0x00 ‖ bytes)`,
Ed25519 (RFC 8032), base64url without padding, RFC 3339 UTC time (as Evidence Wire Format v1 §2).

## 3 `catalogue.json`

```json
{ "catalogue_version": 1, "issued_at": "2026-11-20T10:00:00.000Z", "entries": [ … ] }
```

The file bytes must equal `JCS(parsed object)` (no trailing newline). `entries` sorted by `id`,
`id` unique. `issued_at` strictly increases with every published catalogue.

### Entry fields

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string `^[a-z0-9][a-z0-9._-]{1,63}$` | Stable model id, used in evidence (`model_id`) |
| `tier` | `"small"` \| `"medium"` | Hardware tier |
| `display_name` | string | Shown in the UI |
| `upstream` | `{repo, revision}` | Upstream repository (e.g. `Qwen/Qwen3-4B`) and the full 40-hex commit hash |
| `source_weights_digest` | 64 hex \| `null` | §4. Required for `own`; `null` allowed only for `third-party` when the upstream repo publishes no safetensors (GGUF-only), in which case the deviation review covers provenance |
| `conversion` | `{tool, version}` | Tool that produced the GGUF (e.g. `llama.cpp convert_hf_to_gguf.py`) and its exact version/build tag |
| `quantisation` | `{method}` | e.g. `Q4_K_M` |
| `artefact` | `{filename, size_bytes, sha256, mirror_url}` | The GGUF AIOS downloads; `filename` `^[A-Za-z0-9._-]+\.gguf$`; `mirror_url` `https://` on the `model-mirror` host of Network allowlist v1 |
| `licence` | `{spdx, reference}` | SPDX identifier; repository path to the licence text (e.g. `licences/Qwen3-4B/LICENSE`) |
| `publisher` | string | Who published the artefact (organisation or account) |
| `pipeline` | `"own"` \| `"third-party"` | Produced by our own conversion pipeline, or taken from a third party |
| `deviation_review` | `null` \| `{reviewer, date, quality_threshold_result}` | `null` iff `pipeline = "own"`; required object iff `"third-party"`. `date` is `YYYY-MM-DD`; `quality_threshold_result` is `"pass"` \| `"fail"` (an entry with `"fail"` must not be published) |
| `min_ram_gb` | integer ≥ 1 | Minimum installed RAM |
| `context_length` | integer ≥ 512 | Context window AIOS configures |

## 4 `source_weights_digest`

1. Take every `*.safetensors` file of `upstream.repo` at `upstream.revision`.
2. For each, a line `"<sha256 of file, lowercase hex>  <filename>"` (two spaces), where
   `filename` is the path relative to the repository root with `/` separators.
3. Sort lines by `filename`, byte-wise on UTF-8. Join with LF, LF after the last line too.
4. `source_weights_digest = SHA-256(manifest bytes)` (plain SHA-256, no domain tag, so it can be
   reproduced with `sha256sum *.safetensors | sort -k2 | sha256sum` on a checkout).

## 5 Signature `catalogue.json.sig`

JCS JSON (`signature.schema.json`): `{"alg": "ed25519", "key_id": "<64 hex>", "sig": "<b64url>"}`.

`sig = Ed25519(catalogue_key, H("aios/model-catalogue/v1", catalogue_file_bytes))`.

- The app pins a set of trusted catalogue `key_id`s (and public keys) at build time. A catalogue
  signed by any other key is rejected.
- The signing key is held offline by the release owner; `tools/catalogue/sign.py` signs.

## 6 Acceptance and installation rules

The backend, in this order:

1. Verifies the signature over the exact bytes received, **before** parsing JSON (`C_SIG`,
   `C_UNKNOWN_KEY`).
2. Parses, checks canonical form and schema (`C_FORMAT`), `catalogue_version = 1`.
3. Rejects `issued_at` older than the last accepted catalogue (`C_ROLLBACK`); keeps the last
   accepted catalogue if a newer one fails.
4. Downloads an artefact only from `mirror_url` if its host:port is in the allowlist
   (`C_HOST`), to a temporary file in the models folder; aborts if more than `size_bytes`
   arrive.
5. Accepts the file only if size equals `size_bytes` and SHA-256 equals `sha256`
   (`C_ARTEFACT`); then renames it into `models\` and records `model_installed`. Entries with
   `pipeline = "third-party"` are installable only if `deviation_review.quality_threshold_result`
   is `"pass"` (`C_REVIEW`).
6. Re-verifies size and SHA-256 of installed models before first load after an update.

A model is never loaded from a file that has not passed step 5. Unknown fields in a signed
catalogue are ignored (extension rule).

## 7 Spec check

- [ ] MVP 9.6 / Master 9.3: confirm the field list (the names above are the agreed names used by
  A-04 entries; check meaning and completeness against the spec text).
- [ ] Signing key custody, rotation and who runs `sign.py` (release process, A-01/A-05).
- [ ] Whether a catalogue is bundled in the installer, and how it is updated (feed vs mirror).
- [ ] Definition and procedure of the quality threshold for deviation reviews.
- [ ] Whether `tier` values beyond small/medium exist in Phase 1a.

## 8 Open questions — PROPOSED, confirm against open question list (1, 6–13)

- **P-1 Signature over bytes.** PROPOSED: sign the exact file bytes (which must be JCS) with a
  domain tag; verify before parsing. No re-canonicalisation is needed to verify.
- **P-2 Rollback protection.** PROPOSED: monotonic `issued_at`; reject older catalogues.
- **P-3 Key pinning.** PROPOSED: a set of pinned keys in the build, so a key can be rotated by
  shipping the new key in an update before the first catalogue signed with it.
- **P-4 Weights digest.** PROPOSED: plain SHA-256 over the sorted `sha256sum`-style manifest,
  reproducible with standard tools.
- **P-5 Third-party artefacts.** PROPOSED: allowed only with a deviation review whose result is
  `pass`; enforced by schema (`if pipeline = third-party then deviation_review required`).
- **P-6 Draft vs published.** PROPOSED: the unsigned working draft (`catalogue/catalogue.draft.json`)
  may hold `null`/`"pending"` placeholders; only a complete catalogue valid against this schema
  is signed. `quality_threshold_result` is `"pass"` or `"fail"` in a published catalogue.
