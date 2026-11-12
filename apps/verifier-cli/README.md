# @aios/verifier-cli: `aios-verify`

Independent verifier for AIOS evidence export bundles
([evidence-wire-format v1](../../contracts/evidence-wire-format/v1/spec.md)).

The evidence writer (`services/evidence-writer`) produces a hash-chained, signed log and exports
it as ZIP bundles. This tool is the *second, independent* implementation: it shares no code with
anything else in the repository and reads only the contract. An auditor runs it on an export,
with no AIOS installation, to learn whether the log is intact.

It uses Node.js built-ins only (`node:crypto` for SHA-256 and Ed25519, `node:zlib` for deflate),
with its own RFC 8785 canonical JSON, its own strict ZIP reader and hand-written schema checks.

## Usage

```
aios-verify <bundle.zip> [<bundle.zip> ...] [--json] [--expect-key <key_id>]
```

- Give every bundle of the same stream together (e.g. the export of a restored device *and* of
  the original device): that is how branches are found.
- `--json` prints the full machine-readable result.
- `--expect-key <key_id>` checks the epoch-1 key (the trust anchor) against a key_id you obtained
  out of band; a mismatch gives `unknown_signer`.

The first output line is exactly one verdict word. After it come, per stream: the stream id, the
epoch range, the key_id of each epoch (epoch 1 is the trust anchor), and per bundle the export id,
range, tip hash, event and checkpoint counts, scope, custody statement and manifest signer, then
branches, error codes and warnings. Output never contains event bodies; only ids, hashes, counts
and the manifest's custody and scope fields.

### Verdicts and exit codes

| Verdict | Meaning | Exit |
| --- | --- | --- |
| `intact` | Every check passes; one chain | 0 |
| `branched` | Valid, but two events share one `prev_hash` (e.g. a restore while the old device kept writing): needs attention | 1 |
| `truncated` | Events stop before the manifest's `to_seq`/`tip_hash` while every present event verifies | 2 |
| `unknown_signer` | A manifest or checkpoint `key_id` is not the key declared for its epoch, or `--expect-key` differs | 2 |
| `altered` | A hash, link, signature, schema, canonical form or file digest fails | 2 |
| | Usage error, unreadable file | 3 |

Precedence when several apply: `altered` > `unknown_signer` > `truncated` > `branched` > `intact`.

Error codes are those of spec section 11, plus `E_FILE_DIGEST` (a file's size or sha256 differs
from the manifest and truncation does not explain it). Warnings: `W_UNSIGNED_TAIL` (events after
the last checkpoint), `W_UNKNOWN_TYPE` (an event type this v1 verifier does not know; it is still
hashed, linked and covered by signatures).

## How an auditor runs it

1. Get the export bundle(s) and, through a separate channel (in person, signed letter, phone),
   the epoch-1 `key_id` of the installation.
2. With Node.js 22 and a built copy of this package:
   ```
   node dist/cli.js export.zip --expect-key <key_id>
   ```
   (or `aios-verify ...` when installed, via the `bin` entry).
3. Read the verdict. For `branched`, the output names the seq after which the branches split and
   the first event of each branch; check that this matches a known restore.

## What is checked

Per bundle:

- ZIP: exactly `manifest.json`, `manifest.sig.json`, `events.jsonl`, `checkpoints.jsonl`; stored
  or deflate only; no encryption, directories, symlinks, ZIP64 or duplicate names; local and
  central headers agree; inflation stops at the declared size (and at the manifest's `size_bytes`
  for the data files); CRC-32 checked.
- Every object is parsed and re-serialised with JCS; any byte difference is `E_NONCANONICAL`.
  Floats and integers beyond 2^53−1 are rejected. JSONL lines are LF-terminated.
- Shape checks mirroring the `*.schema.json` files (required fields, patterns, enums, ranges,
  per-type event bodies; unknown fields are allowed and hashed).
- `key_id = H("aios/key/v1/ed25519", key)` for every key in the manifest and the chain.
- Chain: `event_hash = H("aios/evidence/v1/event", JCS(event))`, every `prev_hash` link, seq
  contiguity from 0, the genesis rule, epoch rules (only a `continuation` raises the epoch, by 1,
  with consistent `previous_epoch`, `previous_key_id`, `resumed_from` and `last_checkpoint`).
- The manifest's keys equal the keys the chain declares (`store_created`, then each
  `continuation`).
- `manifest.sig.json` verifies under the key of the tip's epoch.
- Every checkpoint matches the computed hash at its seq, is signed by the key declared for its
  epoch (or by the previous epoch's key over a `continuation`, the handover), and verifies.
  `checkpoints.jsonl` matches `manifest.checkpoints`.
- Size and sha256 of the data files against the manifest; a mismatch is explained only by
  truncation (fewer events, every present one verifying, checkpoints beyond the last event still
  verifying under the manifest's keys).

Across bundles of the same stream: the union of all verified events; two distinct events with the
same `prev_hash` are a branch.

## Library

```ts
import { verifyBundles, commitment, canonicalize } from "@aios/verifier-cli";
```

`commitment(tag, nonce, bytes)` reproduces section 8 (`H(tag, nonce || bytes)`).

## Development

```
pnpm --filter @aios/verifier-cli test       # vitest: golden vectors, JCS, ZIP strictness, CLI
pnpm --filter @aios/verifier-cli typecheck
pnpm --filter @aios/verifier-cli build      # tsc -> dist/
```

Tests name their acceptance criteria (`ac-13`, `ac-18`). The golden vectors are read from
`contracts/evidence-wire-format/v1/golden-vectors/`; never edit them here.

A standalone single-executable build (Node SEA) is not part of this package yet; the built
`dist/` with any Node.js 22 runtime is the supported way to run it.
