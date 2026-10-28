# Evidence Wire Format v1

| Item | Value |
| --- | --- |
| Version | 1 |
| Status | draft |
| Extension rule | Later versions add optional fields only; semantics never change. |
| Freezes | week 2, by ticket F-02 (golden vectors + `FROZEN`) |
| Owner of the code | Evidence writer (`services/evidence-writer`, Python) and independent verifier (`apps/verifier-cli`, TypeScript); canonical JSON and hashing in `packages/py/aios-wire` |
| Schemas | `event.schema.json`, `checkpoint.schema.json`, `export-manifest.schema.json` |

## 1 Purpose

The byte-exact format of the evidence log: append-only, hash-chained events, signed
checkpoints, streams, epochs, branches, commitments and the export bundle. Two independent
implementations (writer in Python, verifier in TypeScript sharing no code) must produce and
accept the same bytes. The log is content-free: it proves *that* and *what exactly* happened
by hash, never stores the content itself.

## 2 Conventions (normative)

| Item | Rule |
| --- | --- |
| Canonical JSON | RFC 8785 (JCS). Every hashed or signed object is serialised with JCS; UTF-8, no BOM, no trailing newline. |
| Numbers | Integers only, `0 ≤ n ≤ 2^53−1`. No floats anywhere in this format. |
| Digest | SHA-256, written as 64 lowercase hex characters. |
| Domain separation | `H(tag, bytes) = SHA-256( UTF-8(tag) ‖ 0x00 ‖ bytes )`. Tags listed in section 9. |
| Signatures | Ed25519 (RFC 8032, pure, not Ed25519ph). Signature = 64 bytes, base64url without padding. |
| Public key | 32 raw bytes, base64url without padding. `key_id = H("aios/key/v1/ed25519", raw_public_key)`. |
| Binary in JSON | base64url without padding (RFC 4648 §5). |
| Time | RFC 3339 UTC with milliseconds and `Z`, e.g. `2026-10-28T09:15:02.123Z`. Informative only; order is `seq`. |
| Identifiers | `stream_id`: UUID (any version) in lowercase 8-4-4-4-12 form. |

Forward compatibility: additive changes keep `"v": 1`. v1 writers emit only the fields defined
here; readers accept and hash unknown fields and ignore their meaning (schemas therefore allow
additional properties). An unknown field never changes the meaning of a known one.

A reader re-serialises every parsed object with JCS and rejects it if the bytes differ from
the bytes it received (`E_NONCANONICAL`).

## 3 Concepts

- **Stream**: one evidence log with a stable `stream_id`, created with the store.
- **Event**: one record; `seq` starts at 0 and increases by exactly 1; each event names the hash
  of its predecessor.
- **Epoch**: integer starting at 1. It increases by exactly 1 on restore or signing-key
  rotation, and only through a `continuation` event (section 6).
- **Checkpoint**: a signed statement "the tip of stream S at seq N is hash H", made with the
  signing key of the current epoch.
- **Branch**: two or more distinct events in one stream with the same `prev_hash`. Each branch
  can be valid on its own (e.g. a restore on a new device while the old device kept writing).
- **Commitment**: a hiding hash binding an event to exact model input or output bytes.

## 4 Event

```json
{
  "v": 1,
  "stream_id": "…",
  "epoch": 1,
  "seq": 42,
  "prev_hash": "<64 hex>",
  "time": "2026-10-28T09:15:02.123Z",
  "type": "inference_completed",
  "body": { }
}
```

- `event_hash = H("aios/evidence/v1/event", JCS(event))`. `event_hash` is not a field of the
  event; it is computed (the writer may store it in a column for indexing).
- `seq = 0` (genesis): `prev_hash` is 64 zeros, `epoch = 1`, `type = "store_created"`.
- `seq > 0`: `prev_hash` = `event_hash` of an event with `seq − 1` in the same stream.
- `epoch` of an event ≥ `epoch` of its predecessor; it may only increase on a `continuation`
  event, by exactly 1.
- `body` is an object whose fields are defined per `type` (section 5). It must not contain
  message text, titles, file names, prompts, model output or any secret.

## 5 Event types (v1 registry)

| type | body fields (all required unless marked ?) |
| --- | --- |
| `store_created` | `signing_key` (public key, b64url), `key_id`, `app_version` |
| `recovery_package_written` | `package_id`, `package_digest` (H over the package file bytes, tag `aios/recovery/v1/file`) |
| `recovery_key_issued` | `package_id` (records that the key was shown once; never the key) |
| `continuation` | see section 6 |
| `project_created` | `project_id`, `classification` |
| `conversation_created` | `conversation_id`, `project_id`, `classification` |
| `inference_completed` | `conversation_id`, `message_id`, `provider` (`local`\|`company`), `model_id`, `input_commitment`, `output_commitment`, `tokens_in`, `tokens_out`, `status` (`ok`\|`cancelled`\|`error`) |
| `disclosure_confirmed` | `conversation_id`, `provider`, `classification` (explicit user confirmation before a Company call) |
| `model_installed` | `model_id`, `artefact_sha256`, `catalogue_issued_at` |
| `project_exported` / `project_imported` | `project_id`, `package_id`, `manifest_digest` |
| `evidence_exported` | `export_id`, `to_seq`, `tip_hash` |

`project_id`, `conversation_id`, `message_id`, `package_id`, `export_id`: UUID strings.
`classification`: `restricted` \| `internal` \| `public`.

Later versions may add event types and optional body fields. A v1 verifier verifies the chain,
hashes and signatures of events of unknown type and reports them as `unknown_type`; it does not
fail on them.

## 6 Continuation (restore and key rotation)

Body: `reason` (`restore`\|`key_rotation`), `previous_epoch`, `resumed_from` (`{seq, event_hash}`
of the last event present in the restored or current log, equal to `prev_hash`),
`last_checkpoint` (`{seq, event_hash}` of the last checkpoint present), `signing_key`, `key_id`
(the key of the new epoch; equal to the old one on a restore without rotation).

- The event has `epoch = previous_epoch + 1` and is the first event of that epoch.
- On `key_rotation` the writer first writes a checkpoint covering the continuation event signed
  with the **old** key, then signs subsequent checkpoints with the new key. This hands trust
  from old key to new key inside the chain.
- On `restore` the old device may have written events after the backup; the result is a
  branch at `resumed_from`. The verifier reports both branches; neither is an error by itself.

## 7 Checkpoint

```json
{ "v": 1, "stream_id": "…", "epoch": 1, "seq": 42, "event_hash": "<64 hex>",
  "time": "…", "key_id": "<64 hex>", "sig": "<b64url>" }
```

- `sig = Ed25519(signing_key, H("aios/evidence/v1/checkpoint", JCS(checkpoint without "sig")))`
  — the 32-byte digest is the signed message.
- `key_id` must be the key declared for `epoch` by `store_created` (epoch 1) or by the
  `continuation` that opened the epoch.
- When: PROPOSED (P-3) after every 100 events or 5 minutes with new events, at clean shutdown,
  before an evidence export and after every `continuation`.

## 8 Commitments

`commitment = H(tag, nonce ‖ bytes)` with a fresh 32-byte random `nonce` per commitment.

| tag | bytes |
| --- | --- |
| `aios/evidence/v1/commit/input` | JCS of `{"model": <model_id>, "messages": [{"role", "content"}…]}` exactly as the context builder sent to the gateway |
| `aios/evidence/v1/commit/output` | UTF-8 bytes of the complete assistant message as saved in `chats.db` |

The nonce is stored with the message in the encrypted `chats.db`, never in evidence. Anyone
holding content + nonce can prove the binding; the evidence log alone reveals nothing, even for
short or guessable content.

## 9 Domain tags (v1)

`aios/evidence/v1/event`, `aios/evidence/v1/checkpoint`, `aios/evidence/v1/commit/input`,
`aios/evidence/v1/commit/output`, `aios/evidence/v1/export`, `aios/key/v1/ed25519`.

## 10 Export bundle

A ZIP with exactly three entries (stored or deflate, no encryption, no directories, no
symlinks, UTF-8 names; readers reject any other entry and enforce the sizes in the manifest
while inflating):

- `manifest.json` (`export-manifest.schema.json`): stream, range, tip, all public keys per epoch,
  and `{path, size_bytes, sha256}` of every other file.
- `events.jsonl`: one JCS event per line, LF-terminated, in `seq` order (branches: all events,
  ordered by `seq` then `event_hash`).
- `checkpoints.jsonl`: one JCS checkpoint per line; the last one covers `to_seq`.

`manifest_digest = H("aios/evidence/v1/export", JCS(manifest))` is recorded in the
`evidence_exported` event.

## 11 Verification and rejection

The verifier reports one of `valid`, `valid_with_branches`, `invalid`, plus warnings. Errors:

| Code | Condition |
| --- | --- |
| `E_SCHEMA` | Object invalid against its schema, or `v` ≠ 1 |
| `E_NONCANONICAL` | Bytes differ from JCS re-serialisation |
| `E_PREV_MISMATCH` | `prev_hash` does not match any event with `seq − 1` |
| `E_SEQ_GAP` | Missing `seq` between genesis and `to_seq` |
| `E_EPOCH` | Epoch decreases, jumps by >1, or increases on a non-continuation event |
| `E_BAD_SIG` | Checkpoint signature does not verify |
| `E_UNKNOWN_SIGNER` | Checkpoint `key_id` not declared for its epoch |
| `E_CHECKPOINT_MISMATCH` | Checkpoint `event_hash` differs from the computed hash at `seq` |
| `E_TRUNCATED` | Manifest `to_seq`/`tip_hash` not present, or file digest mismatch |

Warning `W_UNSIGNED_TAIL`: events after the last checkpoint (reported, not invalid).
Golden vectors (F-02): valid, altered, truncated, branched, unknown-signer.

## 12 Spec check

- [ ] MVP 9.2 / Master 9.3: confirm the minimum field list of event, checkpoint and export.
- [ ] Confirm the event-type list and names against the spec (`store_created`,
  `recovery_package_written`, `recovery_key_issued` are named in the developer brief).
- [ ] GV-01, GV-02, M-11, M-12, M-13: confirm verifier outputs and the trust anchor for epoch 1.
- [ ] Confirm the canonical JSON choice once `packages/py/aios-wire` exists (not in this repo
  yet); this draft assumes RFC 8785.

## 13 Open questions — PROPOSED, confirm against open question list (1, 6–13)

- **P-1 Canonicalisation.** PROPOSED: RFC 8785 JCS, integers only. Mature implementations in
  both languages; integers-only removes JCS's float edge cases.
- **P-2 Hiding commitments.** PROPOSED: 32-byte random nonce per commitment, stored only in
  `chats.db`. Without a nonce, short answers could be confirmed by guessing.
- **P-3 Checkpoint frequency.** PROPOSED: 100 events / 5 minutes / shutdown / export /
  continuation.
- **P-4 Trust anchor.** PROPOSED: epoch-1 key is taken from `store_created` and the verifier
  prints its `key_id`; an auditor compares it out of band (optionally `--expect-key <key_id>`).
- **P-5 Restore keeps the key.** PROPOSED: restore increments the epoch but keeps the signing key
  from the Recovery Package; rotation is a separate `continuation` with `reason: key_rotation`.
- **P-6 Content-free bodies.** PROPOSED: IDs, classifications, digests and counts only; no
  names or titles.
- **P-7 Unknown event types.** PROPOSED: allowed in later versions; v1 verifiers verify and
  report them, never fail.
