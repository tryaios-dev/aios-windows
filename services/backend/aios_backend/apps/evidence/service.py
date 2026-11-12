"""Evidence rules on the backend side: list queued events and report the writer's state.

The evidence writer (services/evidence-writer) hash-chains and signs the events, makes
checkpoints and builds exports. The pump (aios_backend/evidence/pump.py) sends it the outbox and
stores its replies with ``record_append``, ``record_checkpoint`` and ``record_writer_report``
(tables in models.py). While the writer is not running, events stay pending and an export is
checked and then refused with ``503 writer_unavailable``; nothing is lost.
"""

import io
import json
import os
import zipfile
from collections.abc import Callable, Sequence
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy.orm import Session

from aios_backend.apps.evidence import repository as repo
from aios_backend.apps.evidence.models import EvidenceCheckpoint, EvidenceReceipt
from aios_backend.apps.evidence.schemas import (
    Checkpoint,
    EvidenceEventOut,
    EvidenceExportIn,
    EvidenceExportOut,
    EvidenceStatus,
    EvidenceStream,
)
from aios_backend.errors import AppError, not_found
from aios_backend.evidence.client import WriterClient, WriterUnavailable
from aios_common.canonical import utc_time
from db import outbox
from db.base import utcnow
from db.models import EvidenceOutbox

MAX_EVENTS = 1000
WRITER_FRESH = timedelta(seconds=60)  # the writer counts as running if it answered this recently


def _event_out(
    row: EvidenceOutbox, stream_id: str | None, receipt: EvidenceReceipt | None = None
) -> EvidenceEventOut:
    payload = json.loads(row.body)
    provider = payload.get("provider")

    def text(key: str) -> str | None:
        value = payload.get(key)
        return value if isinstance(value, str) else None

    return EvidenceEventOut(
        id=row.id,
        event_id=row.event_id,
        event_type=row.type,
        actor=row.actor,
        ts=row.time,
        project_id=row.project_id,
        conversation_id=row.conversation_id,
        payload=payload,
        seq=row.seq,
        pending=row.seq is None,
        stream_id=stream_id,
        provider=provider if provider in ("local", "company") else None,
        model_digest=text("artifact_sha256"),
        input_commitment=text("input_commitment"),
        output_commitment=text("output_commitment"),
        epoch=receipt.epoch if receipt else None,
        prev_hash=receipt.prev_hash if receipt else None,
        event_hash=receipt.event_hash if receipt else None,
    )


def _stream_id(session: Session) -> str | None:
    identity = repo.store_identity(session)
    return identity[0] if identity else None


def list_events(
    session: Session,
    project_id: str | None,
    event_types: Sequence[str] = (),
    since: datetime | None = None,
    until: datetime | None = None,
    limit: int = MAX_EVENTS,
) -> list[EvidenceEventOut]:
    stream_id = _stream_id(session)
    rows = repo.events(session, project_id, min(limit, MAX_EVENTS), event_types, since, until)
    found = repo.receipts(session, [row.id for row in rows if row.seq is not None])
    return [_event_out(row, stream_id, found.get(row.id)) for row in rows]


def get_event(session: Session, seq: int) -> EvidenceEventOut:
    row = repo.event_by_seq(session, seq)
    if row is None:
        raise not_found("event")
    receipt = repo.receipts(session, [row.id]).get(row.id)
    return _event_out(row, _stream_id(session), receipt)


def _writer_running(session: Session) -> bool:
    state = repo.writer_state(session)
    seen = state.last_seen_at if state else None
    return seen is not None and utcnow() - seen <= WRITER_FRESH


def status(session: Session) -> EvidenceStatus:
    writer = "ok" if _writer_running(session) else "unavailable"
    return EvidenceStatus(writer=writer, pending=repo.pending_count(session))


def stream(session: Session) -> EvidenceStream:
    identity = repo.store_identity(session)
    if identity is None:
        raise AppError("store_not_created", 409)
    stream_id, signer_key_id, created_at = identity
    state = repo.writer_state(session)
    # Each restore starts an epoch; the writer's own count wins once it reports a newer one.
    epoch = max(1 + repo.restore_count(session), (state.epoch or 0) if state else 0)
    return EvidenceStream(
        stream_id=stream_id,
        device_id=state.device_id if state else None,
        epoch=epoch,
        signer_key_id=signer_key_id,
        prior_tip_hash=state.prior_tip_hash if state else None,
        created_at=created_at,
    )


def checkpoints(session: Session, from_seq: int | None, to_seq: int | None) -> list[Checkpoint]:
    """Signed checkpoints the writer reported that overlap the range. None until it runs."""
    stream_id = _stream_id(session) or ""
    return [
        Checkpoint(
            id=c.id,
            stream_id=stream_id,
            epoch=c.epoch,
            seq_from=c.seq_from,
            seq_to=c.seq_to,
            root_hash=c.root_hash,
            signer_key_id=c.signer_key_id,
            signature=c.signature,
            created_at=c.created_at,
        )
        for c in repo.checkpoints(session, from_seq, to_seq)
    ]


# ------------------------------------------------------------------ the writer's replies
def record_append(
    session: Session, outbox_id: int, seq: int, epoch: int, prev_hash: str, event_hash: str
) -> None:
    """The writer appended this outbox event: keep its seq, epoch and chain hashes."""
    row = repo.outbox_row(session, outbox_id)
    if row is None:
        raise not_found("event")
    now = utcnow()
    row.seq, row.acknowledged_at = seq, now
    repo.add_receipt(
        session,
        EvidenceReceipt(
            outbox_id=outbox_id,
            epoch=epoch,
            prev_hash=prev_hash,
            event_hash=event_hash,
            appended_at=now,
        ),
    )


def record_checkpoint(
    session: Session,
    checkpoint_id: str,
    epoch: int,
    seq_from: int,
    seq_to: int,
    root_hash: str,
    signer_key_id: str,
    signature: str,
) -> None:
    if seq_from > seq_to:
        raise AppError("invalid_range", 400)
    repo.save_checkpoint(
        session,
        EvidenceCheckpoint(
            id=checkpoint_id,
            epoch=epoch,
            seq_from=seq_from,
            seq_to=seq_to,
            root_hash=root_hash,
            signer_key_id=signer_key_id,
            signature=signature,
            created_at=utcnow(),
        ),
    )


def record_writer_report(
    session: Session,
    device_id: str | None,
    epoch: int | None,
    prior_tip_hash: str | None,
    tip_hash: str | None,
) -> None:
    """The writer answered: remember what it said about the stream, and when."""
    repo.save_writer_state(
        session,
        {
            "device_id": device_id,
            "epoch": epoch,
            "prior_tip_hash": prior_tip_hash,
            "tip_hash": tip_hash,
            "last_seen_at": utcnow(),
        },
    )


def _write_atomic(target: Path, data: bytes) -> None:
    tmp = target.with_name(target.name + ".part")
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, target)


def export(
    session: Session,
    body: EvidenceExportIn | None,
    writer: WriterClient | None = None,
    flush: Callable[[], object] | None = None,
) -> EvidenceExportOut:
    """Check the request, have the writer build and sign the bundle (F-07), write it where the
    user chose, and record the export. ``flush`` sends queued events to the writer first, so the
    bundle covers everything recorded up to now."""
    if body is None:
        raise AppError("writer_unavailable", 503)
    if not body.confirmed:
        raise AppError("confirmation_required", 400)
    target = Path(body.path)
    if not target.is_absolute() or target.is_dir() or not target.parent.is_dir():
        raise AppError("invalid_path", 400)
    scope: dict[str, str]
    if body.scope == "project":
        assert body.project_id is not None  # checked by the schema
        if not repo.project_exists(session, body.project_id):
            raise not_found("project")
        found = repo.count(session, body.project_id, None, None)
        scope = {"kind": "project", "project_id": body.project_id}
    else:
        assert body.from_ is not None and body.to is not None
        if body.from_ > body.to:
            raise AppError("invalid_range", 400)
        found = repo.count(session, None, body.from_, body.to)
        scope = {"kind": "date_range", "from": utc_time(body.from_), "to": utc_time(body.to)}
    if found == 0:
        raise AppError("nothing_to_export", 409)
    if writer is None:
        raise AppError("writer_unavailable", 503)
    try:
        if flush is not None:
            flush()
        bundle, info = writer.export(scope)
    except WriterUnavailable as exc:
        code = exc.code if exc.code == "nothing_to_export" else "writer_unavailable"
        raise AppError(code, 409 if code == "nothing_to_export" else 503) from exc
    with zipfile.ZipFile(io.BytesIO(bundle)) as zf:
        manifest = json.loads(zf.read("manifest.json"))
    _write_atomic(target, bundle)
    outbox.record(
        session,
        "evidence_exported",
        project_id=body.project_id if body.scope == "project" else None,
        body={
            "export_id": info["export_id"],
            "to_seq": info["to_seq"],
            "tip_hash": info["tip_hash"],
            "manifest_digest": info["manifest_digest"],
            "scope": body.scope,
        },
    )
    epochs = [k["epoch"] for k in manifest["keys"]]
    return EvidenceExportOut(
        file_name=target.name,
        path=str(target),
        size_bytes=len(bundle),
        stream_id=manifest["stream_id"],
        epoch_range=(min(epochs), max(epochs)),
        first_seq=manifest["scope"]["first_seq"],
        last_seq=manifest["scope"]["last_seq"],
        expected_tip=manifest["tip_hash"],
        signer_key_ids=[k["key_id"] for k in manifest["keys"]],
        checkpoint_ids=[f"{c['seq']}-{c['key_id'][:16]}" for c in manifest["checkpoints"]],
        custody=manifest["custody"],
        exported_at=utcnow(),
        scope=body.scope,
    )
