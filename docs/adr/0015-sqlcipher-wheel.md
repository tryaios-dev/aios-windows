# ADR 0015 — SQLCipher through the `sqlcipher3` wheel (E-01)

**Status:** accepted · **Date:** 2026-11-12

**Context.** `chats.db` must be encrypted at rest with a raw 32-byte key from the keystore
(MVP 9.1, FR-30). The backend uses SQLAlchemy + Alembic and is frozen by PyInstaller, so the
SQLCipher build must be a Python wheel that ships its own native library. Building SQLCipher
from source in CI was the alternative. Migrations also need a safe copy of the database before
they run (E-06), and that copy must stay encrypted.

**Decision.**
- **Windows (shipped):** `sqlcipher3==0.6.4`, which bundles SQLCipher 4.19.0 community. Linux
  (CI and development only, never shipped): `sqlcipher3-binary==0.6.0`. Both are pinned in
  `services/backend/pyproject.toml` and `build/sqlcipher/pin.json`, and are changed together.
  `test_database.py` fails if the installed build differs from the pin, and `tools/release/sbom.py`
  lists it.
- Only `db/sqlcipher` imports the driver (import-linter). The key is applied as a raw hex key
  (`PRAGMA key = "x'…'"`) on every connection, before any other statement.
- **Backups use SQLite's online backup API** between two keyed connections
  (`db.sqlcipher.backup_encrypted`). The copy is encrypted with the same key, and
  `PRAGMA integrity_check` verifies it before a migration is allowed to run. Copying the file
  bytes was rejected: it can capture a half-written WAL state.
- **Full-text search** uses FTS5 with the trigram tokenizer as a contentless table. SQLCipher
  4.19.0 builds FTS5, and `aios-backend rebuild-search` rebuilds the index from the messages.

**Verified (2026-11-12, Windows 11, the pinned wheel).** The backend test suite checks:
- opening with a raw key, and a wrong key being refused;
- the online backup to a keyed copy, and the integrity check of that copy;
- the refusal of a newer schema (`NewerSchema`, exit code 4);
- FTS5 trigram search and its rebuild;
- every Alembic migration.

Separately, the frozen `backend.exe` creates and opens the encrypted store in
`tools/smoke_backend_exe.py`.

**Consequences.**
- No native toolchain is needed to build the backend. A security fix in SQLCipher waits for a
  wheel release; if one is late, building from source is the fallback and needs a new ADR.
- The Linux wheel is a different build, so Linux CI proves the code paths, not the shipped
  binary. The Windows jobs test the shipped one.
