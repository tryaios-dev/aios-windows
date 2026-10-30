# Project Package v1

| Item | Value |
| --- | --- |
| Version | 1 |
| Status | draft |
| Extension rule | Later versions add optional fields only; semantics never change. |
| Freezes | week 6, by ticket J-01 (golden packages + `FROZEN`) |
| Owner of the code | Backend portability app (`services/backend/aios_backend/apps/portability/`) |
| Schemas | `manifest.schema.json`, `project.schema.json`, `conversation.schema.json` |

## 1 Purpose

The versioned ZIP format for exporting one project (with its conversations, messages and
summaries) and importing it into another AIOS store. Checksums detect damage; golden packages in
CI keep every later build able to import v1 packages.

## 2 Conventions

RFC 8785 JCS for every JSON file, UTF-8, no BOM; SHA-256 lowercase hex;
`H(tag, bytes) = SHA-256(UTF-8(tag) ‖ 0x00 ‖ bytes)`; RFC 3339 UTC time with milliseconds;
UUIDs lowercase. Readers ignore unknown fields (extension rule).

## 3 Layout

```
manifest.json                       first entry, stored (no compression)
project.json
conversations/<conversation_id>.json   one per conversation
```

File extension `.aiosproj`. Every file except `manifest.json` is listed in `manifest.files`
with `{path, size_bytes, sha256}` (plain SHA-256 of the file bytes).
`manifest_digest = H("aios/project-package/v1/manifest", manifest.json bytes)`; it is recorded in
the `project_exported` / `project_imported` evidence events.

## 4 Contents

- `manifest.json`: `format` = `"aios-project-package"`, `v` = 1, `package_id`, `created_at`,
  `app_version`, `project_id`, `classification` (of the project), `counts`
  `{conversations, messages}`, `files`.
- `project.json`: `id`, `name`, `description` (nullable), `classification`, `created_at`,
  `updated_at`.
- `conversations/<id>.json`: `id`, `project_id`, `title`, `classification`, `created_at`,
  `updated_at`, `messages[]`, `summaries[]`.
  - message: `id`, `role` (`user`\|`assistant`\|`system`), `content`, `classification`,
    `created_at`, and for assistant messages `provider` (`local`\|`company`), `model_id`,
    `status` (`ok`\|`cancelled`\|`error`), `tokens_in`, `tokens_out`.
  - summary: `id`, `covers_to_message_id`, `content`, `classification`, `created_at`.
- `classification` everywhere: `restricted` \| `internal` \| `public`.
- Not included: commitment nonces, evidence, keys, provider settings, API keys, model files.

## 5 ZIP rules

Writers produce, and readers reject anything else (`P_ZIP`):
- Methods stored (0) or deflate (8) only; no encryption; no multi-disk; UTF-8 names (flag bit 11).
- Paths: relative, `/` separators, no `..`, no leading `/`, no drive letters, no backslashes, no
  control characters, max 255 bytes, unique after Unicode NFC + case folding.
- No directory entries are written; no symlinks or other special files (external attributes).
- Limits: ≤ 100 000 entries; total uncompressed ≤ 2 GiB; per-entry compression ratio ≤ 100:1;
  sizes checked while inflating, not trusted from headers.
- Every entry except `manifest.json` must be listed in `manifest.files` and vice versa
  (`P_UNLISTED`, `P_MISSING`).

## 6 Import rules

1. Validate ZIP rules, then `manifest.json` (schema, `format`, `v` = 1) before reading other
   entries (`P_FORMAT`).
2. Check each file's size and SHA-256 against the manifest (`P_CHECKSUM`); validate each JSON
   file against its schema and canonical form (`P_FORMAT`).
3. Referential checks: every conversation's `project_id` equals `manifest.project_id`; message
   and summary ids unique (`P_REFERENCE`).
4. Import is all-or-nothing in one database transaction.
5. New `id`s are assigned to the project, conversations, messages and summaries; the original
   `project_id` and `package_id` are stored as provenance. Classifications are imported
   unchanged (never lowered).
6. Record `project_imported` with `package_id` and `manifest_digest`.

Checksums detect damage, not tampering: v1 packages are not signed (P-3).

## 7 Spec check

- [ ] MVP 9.5 / Master 9.3: confirm the minimum content (which entities and fields; whether
  summaries, attachments or settings are included).
- [ ] Confirm file extension and whether export must warn/confirm for `restricted` projects.
- [ ] Confirm golden package set for J-01 (empty project, one of each classification,
  unicode content, large conversation, maximum-size limits).

## 8 Open questions — PROPOSED, confirm against open question list (1, 6–13)

- **P-1 Export of Restricted projects.** PROPOSED: allowed (MVP records but does not enforce
  classification) after an explicit confirmation that names the classification; recorded as
  `project_exported`. Phase 1b policy gates may block it.
- **P-2 Encryption.** PROPOSED: v1 packages are plain ZIP; the user chooses where to save. An
  encrypted package changes how bytes are read, so it would be Project Package v2, not an
  optional field.
- **P-3 Signature.** PROPOSED: none in v1; integrity by checksums, provenance by the evidence
  event in the exporting store. A detached signature can be added later as an optional file.
- **P-4 IDs on import.** PROPOSED: always new ids (no collision with the same project already in
  the store); originals kept as provenance.
- **P-5 Commitment nonces.** PROPOSED: not exported, so a package cannot be used to open
  commitments in the source store's evidence log without the user's explicit evidence export.
