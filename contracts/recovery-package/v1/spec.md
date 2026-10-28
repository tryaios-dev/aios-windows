# Recovery Package v1

| Item | Value |
| --- | --- |
| Version | 1 |
| Status | draft |
| Extension rule | Later versions add optional fields only; semantics never change. |
| Freezes | week 2, by ticket E-03 (reference package as golden vector + `FROZEN`) |
| Owner of the code | Backend recovery app (`services/backend/src/aios_backend/apps/recovery/`); keys from `aios_common.keystore` |
| Schemas | `recovery-package.schema.json` (file `recovery.pkg`), `recovery-payload.schema.json` (decrypted payload) |

## 1 Purpose

`recovery.pkg` makes a backup restorable on a clean device. It holds the store's database key
and evidence signing key, encrypted under a key derived with Argon2id from the **recovery key**,
which is shown to the user exactly once and stored nowhere by AIOS. Without the recovery key the
file reveals nothing but its public header.

## 2 Conventions

As Evidence Wire Format v1 §2: RFC 8785 JCS, integers only, SHA-256 lowercase hex,
`H(tag, bytes) = SHA-256(UTF-8(tag) ‖ 0x00 ‖ bytes)`, base64url without padding for binary,
RFC 3339 UTC time with milliseconds. Restated here so this contract stands alone.

## 3 Recovery key

- 20 random bytes (160 bits) from the OS CSPRNG.
- Display form: Crockford base32 of the 20 bytes (32 characters), then 4 checksum characters =
  the first 20 bits of `H("aios/recovery/v1/key-check", key_bytes)` in Crockford base32;
  36 characters shown as 9 groups of 4 separated by `-`.
- Input normalisation: remove spaces and `-`, uppercase, map `O`→`0`, `I`/`L`→`1`; reject
  `U`. A wrong checksum is reported as a typing error before any KDF runs.
- The KDF input is the 20 raw bytes, not the text.
- Shown once (`recovery_key_issued` evidence event records that it was shown, never the key).
  Never logged, written to disk, put in the clipboard by AIOS automatically, or sent anywhere.

## 4 File format (`recovery.pkg`)

The file is the JCS serialisation of one JSON object (`recovery-package.schema.json`):

| Field | Meaning |
| --- | --- |
| `format` | `"aios-recovery-package"` |
| `v` | `1` |
| `package_id` | UUID, new for every package written |
| `created_at` | time written |
| `stream_id` | evidence stream of the store |
| `signing_key_id` | `key_id` of the wrapped signing key (Evidence Wire Format v1 §2) |
| `kdf` | `{"alg": "argon2id", "version": 19, "memory_kib", "iterations", "parallelism", "salt"}`; salt 16 random bytes; output 32 bytes |
| `aead` | `{"alg": "aes-256-gcm", "nonce"}`; nonce 12 random bytes |
| `ciphertext` | AES-256-GCM ciphertext ‖ 16-byte tag of the payload, base64url |

- `header` = the object without `ciphertext`.
- `wrap_key = Argon2id(password = recovery_key_bytes, salt, memory_kib, iterations, parallelism, length = 32)`.
- `aad = H("aios/recovery/v1/header", JCS(header))` (32 bytes).
- `ciphertext = AES-256-GCM-Encrypt(wrap_key, nonce, plaintext = JCS(payload), aad)`.
- `package_digest` for the `recovery_package_written` evidence event =
  `H("aios/recovery/v1/file", file_bytes)`.

Every write uses a fresh salt and nonce, so each `wrap_key` encrypts exactly one message.

### Payload (`recovery-payload.schema.json`)

| Field | Meaning |
| --- | --- |
| `v` | `1` |
| `db_key` | 32-byte SQLCipher raw key for `chats.db`, base64url |
| `signing_key_seed` | 32-byte Ed25519 private seed (RFC 8032), base64url |
| `stream_id` | must equal the header's |

### KDF parameters

PROPOSED for writing: `memory_kib = 65536` (64 MiB), `iterations = 3`, `parallelism = 4`
(RFC 9106 §4, second recommended option). Readers accept `65536 ≤ memory_kib ≤ 1048576`,
`1 ≤ iterations ≤ 10`, `1 ≤ parallelism ≤ 16` and reject anything else before running the KDF
(no weak or denial-of-service parameters from a crafted file).

## 5 Lifecycle

- Written at store creation (M-15, AC-17) after the keys are created and stored in Windows
  Credential Manager; written atomically (temp file in the same folder, flush, rename).
- Rewritten (new `package_id`, same recovery key, new salt/nonce) when a wrapped key rotates.
  A new recovery key is only issued by an explicit user action; the old package is then
  replaced and the new key shown once.
- Restore: user supplies backup + recovery key → unwrap → open the backed-up `chats.db` with
  `db_key` → put both keys in Credential Manager → writer appends a `continuation` event
  (`reason: restore`, new epoch) signed under the same signing key.

## 6 Rejection rules

| Code | Condition | User-facing result |
| --- | --- | --- |
| `R_FORMAT` | Not JCS, schema invalid, `format`/`v` unknown, `alg` unknown | "This is not a recovery package AIOS can read" |
| `R_KDF_PARAMS` | KDF parameters outside the accepted bounds | same as above |
| `R_CHECKSUM` | Recovery key checksum wrong | "The recovery key has a typing error" |
| `R_UNWRAP` | AES-GCM authentication fails | "Wrong recovery key, or the package is damaged" (one message; no distinction is possible or offered) |
| `R_PAYLOAD` | Payload schema invalid, `stream_id` differs from header, or the public key derived from `signing_key_seed` does not match `signing_key_id` | "The package is damaged" |
| `R_MISMATCH` | Package `stream_id` differs from the backup's evidence stream | "This recovery key belongs to a different store" |

Unwrapped key material lives only in memory, is never logged and is written only to Credential
Manager. No retry limit is enforced by the file (offline attack cost comes from 160-bit key
entropy, not from Argon2id).

## 7 Spec check

- [ ] MVP 9.4 / Master 9.3: confirm the minimum content of the Recovery Package (which keys,
  which metadata) against the spec text.
- [ ] M-15, AC-17: confirm the order of store creation steps and evidence events.
- [ ] Confirm whether the spec requires the recovery key to be printable/QR and its exact
  display length.
- [ ] Confirm the restore drill (M2, week 3) acceptance wording against §5.

## 8 Open questions — PROPOSED, confirm against open question list (1, 6–13)

- **P-1 AEAD.** PROPOSED: AES-256-GCM. Each package has a unique Argon2id-derived key, so the
  96-bit random nonce never repeats under one key; GCM is in Python `cryptography` (already
  locked) and Node `crypto` without extra native dependencies, and is FIPS-approved, which eases
  customer security reviews. XChaCha20-Poly1305's main advantage (nonce-misuse margin) does not
  apply to single-message keys.
- **P-2 Recovery key strength.** PROPOSED: 160 random bits, 36-character display with checksum.
- **P-3 Argon2id parameters.** PROPOSED: 64 MiB / 3 / 4 for writing, bounded on reading.
- **P-4 Contents.** PROPOSED: `db_key` and `signing_key_seed` only. The company API key (lab
  only) is not included; the user re-enters it after restore.
- **P-5 Header in clear.** PROPOSED: `stream_id`, `signing_key_id`, `created_at` are readable
  without the key (lets the UI match package and backup before asking for the key); all of it
  is authenticated as AAD.
- **P-6 Container.** PROPOSED: a single JSON file, not a ZIP; it contains no content.
