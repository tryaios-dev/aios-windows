"""F-01: the chain, checkpoints, single writer, export, backup and restore (M-11, M-12, M-16)."""

import io
import json
import sqlite3
import zipfile
from pathlib import Path

import pytest
from tests.conftest import STREAM, genesis, project_event, ticking_clock

from aios_common.canonical import b64url_decode, jcs, sha256_hex
from aios_evidence_writer import chain
from aios_evidence_writer.keys import MemoryKeys, new_seed
from aios_evidence_writer.store import (
    CHECKPOINT_EVERY,
    EvidenceStore,
    Intent,
    WriterError,
    WriterLocked,
    check_chain,
)


def test_genesis_is_store_created_with_zero_prev_hash(store: EvidenceStore) -> None:
    [r] = store.append([genesis()])
    assert (r.seq, r.epoch, r.prev_hash) == (0, 1, chain.ZERO_HASH)
    [event] = store.events()
    assert event["event"]["type"] == "store_created"
    assert chain.event_hash(event["event"]) == r.event_hash


def test_first_event_must_be_genesis(store: EvidenceStore) -> None:
    with pytest.raises(WriterError, match="genesis_expected"):
        store.append([project_event(1)])


def test_genesis_must_declare_the_writers_key(store: EvidenceStore) -> None:
    with pytest.raises(WriterError, match="signing_key_mismatch"):
        store.append([genesis(seed=new_seed())])


def test_events_link_to_their_predecessor(store: EvidenceStore) -> None:
    receipts = store.append([genesis(), project_event(1), project_event(2)])
    for prev, cur in zip(receipts, receipts[1:], strict=False):
        assert cur.seq == prev.seq + 1
        assert cur.prev_hash == prev.event_hash


def test_a_repeated_intent_id_does_not_create_a_second_event(store: EvidenceStore) -> None:
    store.append([genesis(), project_event(1)])
    again = store.append([project_event(1)])
    assert again[0].seq == 1
    assert len(store.events()) == 2


def test_writer_only_types_are_refused(store: EvidenceStore) -> None:
    store.append([genesis()])
    forged = Intent("x", "continuation", "2026-11-12T10:00:00.000Z", {"reason": "restore"})
    with pytest.raises(WriterError, match="type_not_allowed"):
        store.append([forged])


@pytest.mark.parametrize(
    "body",
    [{"title": "Quarterly figures for the board"}, {"note": "a" * 200}, {"Bad Key": 1}, {"x": 1.5}],
)
def test_ac_20_content_never_enters_the_log(store: EvidenceStore, body: dict[str, object]) -> None:
    store.append([genesis()])
    with pytest.raises(WriterError, match="body_rejected"):
        store.append([Intent("c", "project_created", "2026-11-12T10:00:00.000Z", body)])
    assert len(store.events()) == 1


def test_a_failed_batch_appends_nothing(store: EvidenceStore) -> None:
    store.append([genesis()])
    bad = Intent("c", "project_created", "2026-11-12T10:00:00.000Z", {"title": "a b"})
    with pytest.raises(WriterError):
        store.append([project_event(1), bad])
    assert len(store.events()) == 1


def test_ac_12_a_checkpoint_at_least_every_100_events(store: EvidenceStore) -> None:
    store.append([genesis()] + [project_event(n) for n in range(1, CHECKPOINT_EVERY)])
    [cp] = store.checkpoints()
    assert cp["seq"] == CHECKPOINT_EVERY - 1
    public = chain.public_key(MemoryKeys().seed() or b"")
    assert chain.verify_checkpoint(cp, public)


def test_ac_12_shutdown_checkpoint_covers_the_tip(store: EvidenceStore) -> None:
    store.append([genesis(), project_event(1)])
    cp = store.checkpoint()
    assert cp is not None and cp["seq"] == 1
    assert store.checkpoint() is None  # nothing new to cover


def test_a_tampered_checkpoint_does_not_verify(store: EvidenceStore) -> None:
    store.append([genesis()])
    cp = store.checkpoint()
    assert cp is not None
    public = chain.public_key(MemoryKeys().seed() or b"")
    assert not chain.verify_checkpoint({**cp, "seq": 5}, public)


def test_ac_14_a_second_writer_on_the_same_file_refuses_to_run(
    store: EvidenceStore, tmp_path: Path
) -> None:
    with pytest.raises(WriterLocked):
        EvidenceStore(tmp_path / "evidence.db", MemoryKeys())


def test_the_lock_is_released_when_the_writer_closes(tmp_path: Path) -> None:
    first = EvidenceStore(tmp_path / "evidence.db", MemoryKeys())
    first.close()
    EvidenceStore(tmp_path / "evidence.db", MemoryKeys()).close()


def test_the_chain_survives_a_restart(tmp_path: Path) -> None:
    s = EvidenceStore(tmp_path / "evidence.db", MemoryKeys(), clock=ticking_clock())
    s.init_stream(STREAM)
    s.append([genesis(), project_event(1)])
    s.close()
    s = EvidenceStore(tmp_path / "evidence.db", MemoryKeys(), clock=ticking_clock())
    [r] = s.append([project_event(2)])
    assert r.seq == 2
    s.close()


def test_another_stream_is_refused(store: EvidenceStore) -> None:
    with pytest.raises(WriterError, match="stream_mismatch"):
        store.init_stream("00000000-0000-4000-8000-000000000000")


def test_events_can_be_read_per_project(store: EvidenceStore) -> None:
    other = "99999999-2222-4333-8444-555555555555"
    store.append([genesis(), project_event(1), project_event(2, project_id=other)])
    assert [e["seq"] for e in store.events(project_id=other)] == [2]


def _bundle(data: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        return {name: zf.read(name) for name in zf.namelist()}


def test_export_bundle_is_complete_and_signed(store: EvidenceStore) -> None:
    store.append([genesis(), project_event(1), project_event(2)])
    data, info = store.export({"kind": "stream"})
    files = _bundle(data)
    assert sorted(files) == [
        "checkpoints.jsonl",
        "events.jsonl",
        "manifest.json",
        "manifest.sig.json",
    ]
    manifest = json.loads(files["manifest.json"])
    assert jcs(manifest) == files["manifest.json"]
    assert manifest["to_seq"] == 2 and manifest["from_seq"] == 0
    assert manifest["custody"] == "self-custodied Local, no anchor"
    for f in manifest["files"]:
        assert sha256_hex(files[f["path"]]) == f["sha256"]
    sig = json.loads(files["manifest.sig.json"])
    public = b64url_decode(manifest["keys"][0]["public_key"])
    assert chain.verify_manifest(manifest, sig, public)
    assert info["manifest_digest"] == chain.manifest_digest(manifest)
    # the export first signed a checkpoint over the tip
    last_cp = json.loads(files["checkpoints.jsonl"].splitlines()[-1])
    assert last_cp["seq"] == 2


def test_project_export_names_its_scope(store: EvidenceStore) -> None:
    project = "11111111-2222-4333-8444-555555555555"
    store.append(
        [genesis(), project_event(1), project_event(2, "99999999-2222-4333-8444-555555555555")]
    )
    data, _ = store.export({"kind": "project", "project_id": project})
    manifest = json.loads(_bundle(data)["manifest.json"])
    assert manifest["scope"] == {
        "kind": "project",
        "project_id": project,
        "first_seq": 1,
        "last_seq": 1,
    }
    assert manifest["to_seq"] == 2  # the chain always runs to the tip


def test_export_of_an_empty_scope_is_refused(store: EvidenceStore) -> None:
    store.append([genesis()])
    with pytest.raises(WriterError, match="nothing_to_export"):
        store.export({"kind": "project", "project_id": "99999999-2222-4333-8444-555555555555"})


def test_backup_is_a_verified_copy(store: EvidenceStore, tmp_path: Path) -> None:
    store.append([genesis(), project_event(1)])
    store.checkpoint()
    target = tmp_path / "backups" / "evidence.db"
    store.backup_to(target)
    conn = sqlite3.connect(target)
    conn.row_factory = sqlite3.Row
    state = check_chain(conn, STREAM)
    conn.close()
    assert state.tip_seq == 1


# ------------------------------------------------------------------ restore (AC-17, AC-18)
def _backup_of_worked_store(tmp_path: Path) -> tuple[Path, int]:
    original = EvidenceStore(tmp_path / "old" / "evidence.db", MemoryKeys(), clock=ticking_clock())
    original.init_stream(STREAM)
    original.append([genesis(), project_event(1), project_event(2)])
    original.checkpoint()
    original.append([project_event(3)])  # worked after the last checkpoint
    backup = tmp_path / "backup" / "evidence.db"
    original.backup_to(backup)
    original.close()
    return backup, 3


def test_ac_17_restore_continues_under_a_new_epoch_and_key(tmp_path: Path) -> None:
    backup, tip = _backup_of_worked_store(tmp_path)
    keys = MemoryKeys()  # holds the recovered seed of epoch 1
    old_key_id = chain.key_id(chain.public_key(keys.seed() or b""))
    fresh = EvidenceStore(tmp_path / "new" / "evidence.db", keys, clock=ticking_clock())
    result = fresh.restore(backup, STREAM, min_tip_seq=tip)
    assert result["epoch"] == 2 and result["seq"] == tip + 1
    assert result["previous_key_id"] == old_key_id and result["key_id"] != old_key_id
    assert chain.key_id(chain.public_key(keys.seed() or b"")) == result["key_id"]

    continuation = fresh.events()[-1]["event"]
    assert continuation["type"] == "continuation"
    assert continuation["body"]["resumed_from"]["seq"] == tip
    assert continuation["prev_hash"] == fresh.events()[-2]["event_hash"]
    # Handover: the continuation is covered by a checkpoint of the old key and of the new key.
    signers = {cp["key_id"] for cp in fresh.checkpoints() if cp["seq"] == tip + 1}
    assert signers == {old_key_id, result["key_id"]}
    # The next event is signed with the new key.
    [r] = fresh.append([project_event(9)])
    assert r.epoch == 2
    assert fresh.checkpoint()["key_id"] == result["key_id"]  # type: ignore[index]
    fresh.close()


def test_ac_17_restore_refuses_a_chain_short_of_the_recorded_tip(tmp_path: Path) -> None:
    backup, tip = _backup_of_worked_store(tmp_path)
    fresh = EvidenceStore(tmp_path / "new" / "evidence.db", MemoryKeys())
    with pytest.raises(WriterError, match="chain_short"):
        fresh.restore(backup, STREAM, min_tip_seq=tip + 5)
    assert fresh.events() == []  # nothing changed
    fresh.close()


def test_ac_17_restore_refuses_another_stream_or_key(tmp_path: Path) -> None:
    backup, _ = _backup_of_worked_store(tmp_path)
    fresh = EvidenceStore(tmp_path / "new" / "evidence.db", MemoryKeys(new_seed()))
    with pytest.raises(WriterError, match="stream_mismatch"):
        fresh.restore(backup, "00000000-0000-4000-8000-000000000000")
    with pytest.raises(WriterError, match="signing_key_mismatch"):
        fresh.restore(backup, STREAM)
    fresh.close()


def test_ac_17_restore_refuses_a_tampered_backup(tmp_path: Path) -> None:
    backup, _ = _backup_of_worked_store(tmp_path)
    conn = sqlite3.connect(backup)
    row = conn.execute("SELECT json FROM events WHERE seq = 1").fetchone()
    conn.execute(
        "UPDATE events SET json = ? WHERE seq = 1",
        (row[0].replace("restricted", "public"),),
    )
    conn.commit()
    conn.close()
    fresh = EvidenceStore(tmp_path / "new" / "evidence.db", MemoryKeys())
    with pytest.raises(WriterError, match="chain_invalid"):
        fresh.restore(backup, STREAM)
    fresh.close()


def test_restored_file_verifies_as_a_whole(tmp_path: Path) -> None:
    backup, _ = _backup_of_worked_store(tmp_path)
    fresh = EvidenceStore(tmp_path / "new" / "evidence.db", MemoryKeys())
    fresh.restore(backup, STREAM)
    fresh.close()
    conn = sqlite3.connect(tmp_path / "new" / "evidence.db")
    conn.row_factory = sqlite3.Row
    assert check_chain(conn, STREAM).epoch == 2
    conn.close()
