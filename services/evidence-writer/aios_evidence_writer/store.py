"""evidence.db: the hash chain, its checkpoints and the signing keys of every epoch.

This is the only code in the repository that opens evidence.db (invariant 5, M-12, AC-14).

* One writer per stream: the connection takes SQLite's exclusive lock at open and keeps it, so a
  second writer started against the same file refuses to run (``WriterLocked``). The OS drops the
  lock when the process dies, so a crashed writer never blocks the next one.
* Appending is idempotent per ``intent_id``: a retried intent returns the receipt it already got
  and never creates a second event (F-05 relies on this).
* Checkpoints are signed at least every 100 events, after 5 minutes with new events, on request
  (shutdown, export) and around every continuation (P-3).
* The file holds no content: event bodies are ids, enum values, digests, counts and flags.
"""

import io
import json
import shutil
import sqlite3
import threading
import uuid
import zipfile
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from aios_common.canonical import b64url, b64url_decode, jcs, sha256_hex, utc_time
from aios_evidence_writer import chain
from aios_evidence_writer.keys import KeySource, new_seed

FORMAT = "aios-evidence/1"
FILE_NAME = "evidence.db"  # in the data folder, next to chats.db
CHECKPOINT_EVERY = 100
CHECKPOINT_AFTER = timedelta(minutes=5)
EXPORT_FORMAT = "aios-evidence-export"
WRITER_ONLY_TYPES = frozenset({"continuation"})

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
    seq INTEGER PRIMARY KEY,
    epoch INTEGER NOT NULL,
    type TEXT NOT NULL,
    time TEXT NOT NULL,
    prev_hash TEXT NOT NULL,
    event_hash TEXT NOT NULL UNIQUE,
    intent_id TEXT UNIQUE,
    project_id TEXT,
    conversation_id TEXT,
    json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_project ON events (project_id);
CREATE INDEX IF NOT EXISTS events_time ON events (time);
CREATE TABLE IF NOT EXISTS checkpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    epoch INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    event_hash TEXT NOT NULL,
    key_id TEXT NOT NULL,
    time TEXT NOT NULL,
    json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS keys (
    epoch INTEGER PRIMARY KEY,
    key_id TEXT NOT NULL,
    public_key TEXT NOT NULL
);
"""


class WriterError(Exception):
    """A refused request. ``code`` is the error the API returns; it never holds content."""

    def __init__(self, code: str, status: int = 409) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


class WriterLocked(WriterError):
    def __init__(self) -> None:
        super().__init__("writer_locked", 409)


@dataclass(frozen=True)
class Intent:
    intent_id: str
    type: str
    time: str
    body: dict[str, Any]
    project_id: str | None = None
    conversation_id: str | None = None


@dataclass(frozen=True)
class Receipt:
    intent_id: str
    seq: int
    epoch: int
    prev_hash: str
    event_hash: str


def _now() -> str:
    return utc_time()


def _parse_time(text: str) -> datetime:
    return datetime.strptime(text, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=UTC)


def _connect(path: Path, *, exclusive: bool) -> sqlite3.Connection:
    conn = sqlite3.connect(path, isolation_level=None, timeout=0.2, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    if exclusive:
        conn.execute("PRAGMA locking_mode=EXCLUSIVE")
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("BEGIN EXCLUSIVE")
            conn.execute("COMMIT")
        except sqlite3.OperationalError as exc:
            conn.close()
            if "locked" in str(exc) or "busy" in str(exc):
                raise WriterLocked() from exc
            raise
    conn.executescript(SCHEMA)
    return conn


# ------------------------------------------------------------------ chain check (restore, backup)
@dataclass(frozen=True)
class ChainState:
    stream_id: str
    epoch: int
    tip_seq: int
    tip_hash: str
    last_checkpoint: tuple[int, str] | None
    keys: dict[int, tuple[str, str]]  # epoch -> (key_id, public key b64url)


def check_chain(conn: sqlite3.Connection, stream_id: str | None = None) -> ChainState:
    """Recompute every event hash and link and every checkpoint signature of a file.

    Used before a backup's evidence.db is taken over on restore: a store that does not verify
    is refused (``chain_invalid``) and nothing is changed.
    """
    meta = {r["key"]: r["value"] for r in conn.execute("SELECT key, value FROM meta")}
    if meta.get("format") != FORMAT or "stream_id" not in meta:
        raise WriterError("chain_invalid", 422)
    if stream_id is not None and meta["stream_id"] != stream_id:
        raise WriterError("stream_mismatch", 422)
    keys = {
        r["epoch"]: (r["key_id"], r["public_key"])
        for r in conn.execute("SELECT epoch, key_id, public_key FROM keys")
    }
    prev, epoch, seq = chain.ZERO_HASH, 1, -1
    for row in conn.execute("SELECT seq, event_hash, json FROM events ORDER BY seq"):
        event = json.loads(row["json"])
        if (
            jcs(event).decode() != row["json"]
            or row["seq"] != seq + 1
            or event.get("seq") != row["seq"]
            or event.get("prev_hash") != prev
            or event.get("stream_id") != meta["stream_id"]
            or chain.event_hash(event) != row["event_hash"]
        ):
            raise WriterError("chain_invalid", 422)
        new_epoch = int(event["epoch"])
        if new_epoch != epoch and not (new_epoch == epoch + 1 and event["type"] == "continuation"):
            raise WriterError("chain_invalid", 422)
        epoch, seq, prev = new_epoch, row["seq"], row["event_hash"]
    if seq < 0:
        raise WriterError("chain_invalid", 422)
    by_seq = {r["seq"]: r["event_hash"] for r in conn.execute("SELECT seq, event_hash FROM events")}
    last: tuple[int, str] | None = None
    for row in conn.execute("SELECT json FROM checkpoints ORDER BY id"):
        cp = json.loads(row["json"])
        signers = [keys.get(cp["epoch"]), keys.get(cp["epoch"] - 1)]
        ok = by_seq.get(cp["seq"]) == cp["event_hash"] and any(
            k is not None
            and k[0] == cp["key_id"]
            and chain.verify_checkpoint(cp, b64url_decode(k[1]))
            for k in signers
        )
        if not ok:
            raise WriterError("chain_invalid", 422)
        if last is None or cp["seq"] >= last[0]:
            last = (cp["seq"], cp["event_hash"])
    return ChainState(meta["stream_id"], epoch, seq, prev, last, keys)


class EvidenceStore:
    """Thread-safe: the API runs requests in a thread pool, one lock serialises them."""

    def __init__(self, path: Path, keys: KeySource, clock: Callable[[], str] = _now) -> None:
        self.path = path
        self.keys = keys
        self.clock = clock
        self._lock = threading.RLock()
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = _connect(path, exclusive=True)
        self._meta_set("format", FORMAT, only_if_missing=True)

    # ---------------------------------------------------------------- basics
    def close(self) -> None:
        with self._lock:
            self._conn.close()

    @contextmanager
    def _tx(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                yield self._conn
            except BaseException:
                self._conn.execute("ROLLBACK")
                raise
            self._conn.execute("COMMIT")

    def _meta(self, key: str) -> str | None:
        row = self._conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else None

    def _meta_set(self, key: str, value: str, *, only_if_missing: bool = False) -> None:
        verb = "INSERT OR IGNORE" if only_if_missing else "INSERT OR REPLACE"
        self._conn.execute(f"{verb} INTO meta (key, value) VALUES (?, ?)", (key, value))  # noqa: S608

    def _tip(self) -> sqlite3.Row | None:
        row: sqlite3.Row | None = self._conn.execute(
            "SELECT seq, epoch, event_hash, time FROM events ORDER BY seq DESC LIMIT 1"
        ).fetchone()
        return row

    def _last_checkpoint(self) -> sqlite3.Row | None:
        row: sqlite3.Row | None = self._conn.execute(
            "SELECT seq, event_hash, epoch, key_id, time FROM checkpoints ORDER BY id DESC LIMIT 1"
        ).fetchone()
        return row

    def _epoch_key(self, epoch: int) -> tuple[str, str] | None:
        row = self._conn.execute(
            "SELECT key_id, public_key FROM keys WHERE epoch = ?", (epoch,)
        ).fetchone()
        return (row["key_id"], row["public_key"]) if row else None

    def _signing_seed(self, epoch: int) -> bytes:
        """The seed for ``epoch``; refuses to sign with a key the chain does not declare."""
        seed = self.keys.seed()
        declared = self._epoch_key(epoch)
        if seed is None or declared is None:
            raise WriterError("signing_key_missing", 503)
        if chain.key_id(chain.public_key(seed)) != declared[0]:
            raise WriterError("signing_key_mismatch", 503)
        return seed

    # ---------------------------------------------------------------- status
    def status(self) -> dict[str, Any]:
        with self._lock:
            tip = self._tip()
            cp = self._last_checkpoint()
            epoch = tip["epoch"] if tip else None
            key = self._epoch_key(epoch) if epoch else None
            return {
                "stream_id": self._meta("stream_id"),
                "device_id": self._meta("device_id"),
                "epoch": epoch,
                "tip_seq": tip["seq"] if tip else None,
                "tip_hash": tip["event_hash"] if tip else None,
                "prior_tip_hash": self._meta("prior_tip_hash"),
                "key_id": key[0] if key else None,
                "last_checkpoint_seq": cp["seq"] if cp else None,
                "file_name": FILE_NAME,
            }

    def init_stream(self, stream_id: str) -> None:
        """Bind this file to the store's stream. Idempotent; another stream is refused."""
        uuid.UUID(stream_id)
        with self._tx():
            current = self._meta("stream_id")
            if current is not None and current != stream_id:
                raise WriterError("stream_mismatch", 409)
            self._meta_set("stream_id", stream_id)
            self._meta_set("device_id", str(uuid.uuid4()), only_if_missing=True)

    # ---------------------------------------------------------------- append
    def append(self, intents: list[Intent]) -> list[Receipt]:
        receipts: list[Receipt] = []
        with self._tx() as conn:
            stream_id = self._meta("stream_id")
            if stream_id is None:
                raise WriterError("stream_not_initialised", 409)
            for intent in intents:
                done = conn.execute(
                    "SELECT seq, epoch, prev_hash, event_hash FROM events WHERE intent_id = ?",
                    (intent.intent_id,),
                ).fetchone()
                if done is not None:  # a retry: same event, never a second one
                    receipts.append(Receipt(intent.intent_id, *tuple(done)))
                    continue
                receipts.append(self._append_one(conn, stream_id, intent))
            self._maybe_checkpoint(conn, stream_id)
        return receipts

    def _append_one(self, conn: sqlite3.Connection, stream_id: str, intent: Intent) -> Receipt:
        if intent.type in WRITER_ONLY_TYPES:
            raise WriterError("type_not_allowed", 422)
        try:
            chain.check_body(intent.body)
            _parse_time(intent.time)
        except (chain.BodyRejected, ValueError) as exc:
            raise WriterError("body_rejected", 422) from exc
        tip = self._tip()
        if tip is None:
            # Genesis (section 4): store_created, epoch 1, declaring the key of epoch 1.
            if intent.type != "store_created":
                raise WriterError("genesis_expected", 409)
            seed = self.keys.seed()
            if seed is None:
                raise WriterError("signing_key_missing", 503)
            public = chain.public_key(seed)
            if intent.body.get("key_id") != chain.key_id(public) or intent.body.get(
                "signing_key"
            ) != b64url(public):
                raise WriterError("signing_key_mismatch", 409)
            conn.execute(
                "INSERT INTO keys (epoch, key_id, public_key) VALUES (1, ?, ?)",
                (chain.key_id(public), b64url(public)),
            )
            seq, epoch, prev = 0, 1, chain.ZERO_HASH
        else:
            if intent.type == "store_created":
                raise WriterError("genesis_exists", 409)
            seq, epoch, prev = tip["seq"] + 1, tip["epoch"], tip["event_hash"]
        return self._insert(conn, stream_id, seq, epoch, prev, intent)

    def _insert(
        self,
        conn: sqlite3.Connection,
        stream_id: str,
        seq: int,
        epoch: int,
        prev: str,
        intent: Intent,
    ) -> Receipt:
        event = chain.make_event(stream_id, epoch, seq, prev, intent.time, intent.type, intent.body)
        digest = chain.event_hash(event)
        conn.execute(
            "INSERT INTO events (seq, epoch, type, time, prev_hash, event_hash, intent_id,"
            " project_id, conversation_id, json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                seq,
                epoch,
                intent.type,
                intent.time,
                prev,
                digest,
                intent.intent_id,
                intent.project_id,
                intent.conversation_id,
                jcs(event).decode(),
            ),
        )
        return Receipt(intent.intent_id, seq, epoch, prev, digest)

    # ---------------------------------------------------------------- checkpoints
    def _maybe_checkpoint(self, conn: sqlite3.Connection, stream_id: str) -> None:
        tip, last = self._tip(), self._last_checkpoint()
        if tip is None or (last is not None and last["seq"] == tip["seq"]):
            return
        uncovered = tip["seq"] - (last["seq"] if last else -1)
        stale = (
            last is not None
            and _parse_time(self.clock()) - _parse_time(last["time"]) >= CHECKPOINT_AFTER
        )
        if uncovered >= CHECKPOINT_EVERY or stale:
            self._write_checkpoint(conn, stream_id, tip, self._signing_seed(tip["epoch"]))

    def _write_checkpoint(
        self, conn: sqlite3.Connection, stream_id: str, tip: sqlite3.Row, seed: bytes
    ) -> dict[str, Any]:
        cp = chain.make_checkpoint(
            seed, stream_id, tip["epoch"], tip["seq"], tip["event_hash"], self.clock()
        )
        conn.execute(
            "INSERT INTO checkpoints (epoch, seq, event_hash, key_id, time, json)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (cp["epoch"], cp["seq"], cp["event_hash"], cp["key_id"], cp["time"], jcs(cp).decode()),
        )
        return cp

    def checkpoint(self) -> dict[str, Any] | None:
        """Sign the tip now (shutdown, before an export). None when the tip is already covered."""
        with self._tx() as conn:
            stream_id, tip, last = self._meta("stream_id"), self._tip(), self._last_checkpoint()
            if stream_id is None or tip is None:
                return None
            if last is not None and last["seq"] == tip["seq"]:
                return None
            return self._write_checkpoint(conn, stream_id, tip, self._signing_seed(tip["epoch"]))

    # ---------------------------------------------------------------- reads (F-06)
    def events(
        self,
        project_id: str | None = None,
        since: str | None = None,
        until: str | None = None,
        after_seq: int | None = None,
        limit: int = 1000,
    ) -> list[dict[str, Any]]:
        clauses: list[str] = []
        args: list[str | int] = []
        if project_id is not None:
            clauses.append("project_id = ?")
            args.append(project_id)
        if since is not None:
            clauses.append("time >= ?")
            args.append(since)
        if until is not None:
            clauses.append("time <= ?")
            args.append(until)
        if after_seq is not None:
            clauses.append("seq > ?")
            args.append(after_seq)
        where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
        # The WHERE clauses are fixed strings above; every value is a bound parameter.
        columns = "seq, epoch, event_hash, intent_id, project_id, conversation_id, json"
        sql = f"SELECT {columns} FROM events{where} ORDER BY seq LIMIT ?"  # noqa: S608
        with self._lock:
            rows = self._conn.execute(sql, (*args, max(1, min(limit, 5000)))).fetchall()
        return [
            {
                "seq": r["seq"],
                "epoch": r["epoch"],
                "event_hash": r["event_hash"],
                "intent_id": r["intent_id"],
                "project_id": r["project_id"],
                "conversation_id": r["conversation_id"],
                "event": json.loads(r["json"]),
            }
            for r in rows
        ]

    def checkpoints(self, from_seq: int | None = None, to_seq: int | None = None) -> list[Any]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT json FROM checkpoints WHERE seq >= ? AND seq <= ? ORDER BY id",
                (from_seq or 0, to_seq if to_seq is not None else 2**53),
            ).fetchall()
        return [json.loads(r["json"]) for r in rows]

    # ---------------------------------------------------------------- export (F-07)
    def export(
        self, scope: dict[str, Any], export_id: str | None = None
    ) -> tuple[bytes, dict[str, Any]]:
        """Build the bundle (section 10): manifest.json, manifest.sig.json, events.jsonl and
        checkpoints.jsonl. v1 exports always run from genesis to the tip; the scope (a project or a
        date range) is named in the manifest with the first and last in-scope sequence numbers."""
        self.checkpoint()
        with self._lock:
            stream_id, tip = self._meta("stream_id"), self._tip()
            if stream_id is None or tip is None:
                raise WriterError("nothing_to_export", 409)
            first_last = self._scope_range(scope)
            if first_last is None:
                raise WriterError("nothing_to_export", 409)
            events = self._conn.execute(
                "SELECT json FROM events WHERE seq <= ? ORDER BY seq", (tip["seq"],)
            ).fetchall()
            cps = self._conn.execute(
                "SELECT json, seq, key_id FROM checkpoints WHERE seq <= ? ORDER BY id",
                (tip["seq"],),
            ).fetchall()
            keys = self._conn.execute(
                "SELECT epoch, key_id, public_key FROM keys WHERE epoch <= ? ORDER BY epoch",
                (tip["epoch"],),
            ).fetchall()
            seed = self._signing_seed(tip["epoch"])
        events_bytes = "".join(r["json"] + "\n" for r in events).encode()
        cps_bytes = "".join(r["json"] + "\n" for r in cps).encode()
        manifest: dict[str, Any] = {
            "format": EXPORT_FORMAT,
            "v": chain.V,
            "export_id": export_id or str(uuid.uuid4()),
            "created_at": self.clock(),
            "stream_id": stream_id,
            "from_seq": 0,
            "to_seq": tip["seq"],
            "tip_hash": tip["event_hash"],
            "keys": [
                {"epoch": k["epoch"], "key_id": k["key_id"], "public_key": k["public_key"]}
                for k in keys
            ],
            "files": [
                {
                    "path": "events.jsonl",
                    "size_bytes": len(events_bytes),
                    "sha256": sha256_hex(events_bytes),
                },
                {
                    "path": "checkpoints.jsonl",
                    "size_bytes": len(cps_bytes),
                    "sha256": sha256_hex(cps_bytes),
                },
            ],
            "scope": {**scope, "first_seq": first_last[0], "last_seq": first_last[1]},
            "checkpoints": [{"seq": r["seq"], "key_id": r["key_id"]} for r in cps],
            "custody": chain.CUSTODY,
        }
        signature = chain.sign_manifest(seed, manifest)
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            for name, data in (
                ("manifest.json", jcs(manifest)),
                ("manifest.sig.json", jcs(signature)),
                ("events.jsonl", events_bytes),
                ("checkpoints.jsonl", cps_bytes),
            ):
                # A fixed entry time: the same export gives the same bytes (golden vectors).
                entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                zf.writestr(entry, data)
        info = {
            "export_id": manifest["export_id"],
            "to_seq": tip["seq"],
            "tip_hash": tip["event_hash"],
            "manifest_digest": chain.manifest_digest(manifest),
            "event_count": len(events),
        }
        return buffer.getvalue(), info

    def _scope_range(self, scope: dict[str, Any]) -> tuple[int, int] | None:
        kind = scope.get("kind")
        if kind == "project":
            row = self._conn.execute(
                "SELECT MIN(seq) AS a, MAX(seq) AS b FROM events WHERE project_id = ?",
                (scope.get("project_id"),),
            ).fetchone()
        elif kind == "date_range":
            row = self._conn.execute(
                "SELECT MIN(seq) AS a, MAX(seq) AS b FROM events WHERE time >= ? AND time <= ?",
                (scope.get("from"), scope.get("to")),
            ).fetchone()
        elif kind == "stream":
            row = self._conn.execute("SELECT MIN(seq) AS a, MAX(seq) AS b FROM events").fetchone()
        else:
            raise WriterError("invalid_scope", 422)
        return None if row["a"] is None else (row["a"], row["b"])

    # ---------------------------------------------------------------- backup (E-06)
    def backup_to(self, target: Path) -> None:
        """A consistent copy through SQLite's online backup, checked before it counts."""
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_name(target.name + ".tmp")
        tmp.unlink(missing_ok=True)
        with self._lock:
            dest = sqlite3.connect(tmp)
            try:
                self._conn.backup(dest)
            finally:
                dest.close()
        check = sqlite3.connect(f"file:{tmp.as_posix()}?mode=ro", uri=True)
        check.row_factory = sqlite3.Row
        try:
            if self._tip() is not None:
                check_chain(check)
        finally:
            check.close()
        tmp.replace(target)

    # ---------------------------------------------------------------- restore (E-04, M-16)
    def restore(
        self, backup: Path, stream_id: str, min_tip_seq: int | None = None
    ) -> dict[str, Any]:
        """Take over a backup's evidence.db and continue it under a new epoch and a new key.

        1. The backup must verify (every hash, link and checkpoint) and belong to ``stream_id``;
           it must reach at least ``min_tip_seq`` when the Recovery Package recorded a tip.
        2. The key source must hold the recovered seed of the backup's last epoch.
        3. On a copy: a ``continuation`` event (epoch + 1, ``prev_hash`` = the restored tip, the
           new key in its body), a checkpoint over it signed with the old key, then one signed
           with the new key (section 6: trust handed from old key to new inside the chain).
        4. Only then the copy replaces evidence.db and the new seed replaces the old one. Any
           failure before that leaves the current file and key untouched.
        """
        if backup.is_dir():
            backup = backup / FILE_NAME  # the backed-up data folder
        if not backup.is_file():
            raise WriterError("no_backup_evidence", 422)
        source = sqlite3.connect(f"file:{backup.as_posix()}?mode=ro", uri=True)
        source.row_factory = sqlite3.Row
        try:
            state = check_chain(source, stream_id)
        except sqlite3.DatabaseError as exc:
            raise WriterError("chain_invalid", 422) from exc
        finally:
            source.close()
        if min_tip_seq is not None and state.tip_seq < min_tip_seq:
            raise WriterError("chain_short", 422)
        old_seed = self.keys.seed()
        if (
            old_seed is None
            or chain.key_id(chain.public_key(old_seed)) != state.keys[state.epoch][0]
        ):
            raise WriterError("signing_key_mismatch", 422)

        work = self.path.with_name(self.path.name + ".restoring")
        work.unlink(missing_ok=True)
        shutil.copyfile(backup, work)
        seed = new_seed()
        public = chain.public_key(seed)
        conn = _connect(work, exclusive=False)
        try:
            conn.execute("BEGIN IMMEDIATE")
            epoch = state.epoch + 1
            body: dict[str, Any] = {
                "reason": "restore",
                "previous_epoch": state.epoch,
                "resumed_from": {"seq": state.tip_seq, "event_hash": state.tip_hash},
                "last_checkpoint": {
                    "seq": state.last_checkpoint[0] if state.last_checkpoint else 0,
                    "event_hash": state.last_checkpoint[1]
                    if state.last_checkpoint
                    else state.tip_hash,
                },
                "signing_key": b64url(public),
                "key_id": chain.key_id(public),
                "previous_key_id": state.keys[state.epoch][0],
            }
            conn.execute(
                "INSERT INTO keys (epoch, key_id, public_key) VALUES (?, ?, ?)",
                (epoch, chain.key_id(public), b64url(public)),
            )
            receipt = self._insert(
                conn,
                state.stream_id,
                state.tip_seq + 1,
                epoch,
                state.tip_hash,
                Intent(f"continuation-{uuid.uuid4()}", "continuation", self.clock(), body),
            )
            tip = conn.execute(
                "SELECT seq, epoch, event_hash FROM events WHERE seq = ?", (receipt.seq,)
            ).fetchone()
            self._write_checkpoint(conn, state.stream_id, tip, old_seed)
            self._write_checkpoint(conn, state.stream_id, tip, seed)
            conn.execute(
                "INSERT OR REPLACE INTO meta (key, value) VALUES ('prior_tip_hash', ?)",
                (state.tip_hash,),
            )
            conn.execute(
                "INSERT OR REPLACE INTO meta (key, value) VALUES ('device_id', ?)",
                (str(uuid.uuid4()),),
            )
            conn.execute("COMMIT")
        except BaseException:
            conn.close()
            work.unlink(missing_ok=True)
            raise
        conn.close()

        with self._lock:
            before = self.path.with_name(self.path.name + ".before-restore")
            self._conn.close()
            try:
                if self.path.exists():
                    self.path.replace(before)
                for suffix in ("-wal", "-shm"):
                    Path(str(self.path) + suffix).unlink(missing_ok=True)
                work.replace(self.path)
                self.keys.replace(seed)
            except BaseException:
                if before.exists():
                    before.replace(self.path)
                self.keys.replace(old_seed)
                self._conn = _connect(self.path, exclusive=True)
                raise
            self._conn = _connect(self.path, exclusive=True)
            before.unlink(missing_ok=True)
        return {
            "epoch": receipt.epoch,
            "seq": receipt.seq,
            "event_hash": receipt.event_hash,
            "resumed_from": state.tip_seq,
            "key_id": chain.key_id(public),
            "previous_key_id": state.keys[state.epoch][0],
        }
