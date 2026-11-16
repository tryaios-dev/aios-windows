"""Send queued evidence to the writer and keep its replies in chats.db (F-05).

Order of every action (MVP 16, F-05): the app does the action, writes its local state and the
full event draft to ``evidence_outbox`` in the same transaction; this pump then sends the draft to
the writer under its ``event_id`` as intent id. The writer treats a repeated intent id as the same
event, so a retry after a timeout or a crash can never create a second event. On the writer's
receipt the row gets its ``seq`` and chain hashes (``evidence_receipts``); until then the event
shows as pending. The pump runs at start-up, then every second, so whatever is left in the outbox
when the writer comes back is replayed in order.
"""

import asyncio
import json
from typing import Any

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from aios_backend.apps.evidence import service as evidence
from aios_backend.apps.evidence.models import EvidenceCheckpoint
from aios_backend.components import Components, ComponentState
from aios_backend.evidence.client import WriterClient, WriterUnavailable
from aios_common.canonical import utc_time
from aios_common.logging import get_logger, log_event
from db import lookups
from db.models import EvidenceOutbox
from db.session import Database

BATCH = 200
INTERVAL_S = 1.0
# The writer writes these itself (a continuation on restore); drafts of them are never sent.
WRITER_ONLY = ("continuation",)

log = get_logger("evidence")


def _intent(row: EvidenceOutbox) -> dict[str, Any]:
    return {
        "intent_id": row.event_id,
        "type": row.type,
        "time": utc_time(row.time),
        "body": json.loads(row.body),
        "project_id": row.project_id,
        "conversation_id": row.conversation_id,
    }


def _mirror_checkpoints(session: Session, writer: WriterClient) -> None:
    last = session.scalar(select(func.max(EvidenceCheckpoint.seq_to)))
    known = set(session.scalars(select(EvidenceCheckpoint.id)))
    previous = -1 if last is None else int(last)
    for cp in writer.checkpoints(from_seq=None if last is None else int(last)):
        cp_id = f"{cp['seq']}-{cp['key_id'][:16]}"
        if cp_id in known:
            previous = max(previous, cp["seq"])
            continue
        evidence.record_checkpoint(
            session,
            cp_id,
            epoch=cp["epoch"],
            seq_from=min(previous + 1, cp["seq"]),
            seq_to=cp["seq"],
            root_hash=cp["event_hash"],
            signer_key_id=cp["key_id"],
            signature=cp["sig"],
        )
        known.add(cp_id)
        previous = max(previous, cp["seq"])


def _adopt_writer_events(session: Session, writer: WriterClient) -> None:
    """A restore makes the writer write a ``continuation`` itself; the backend queued a mirror
    row for it. Match pending mirror rows to the writer's continuation events, in order."""
    pending = session.scalars(
        select(EvidenceOutbox)
        .where(EvidenceOutbox.seq.is_(None), EvidenceOutbox.type.in_(WRITER_ONLY))
        .order_by(EvidenceOutbox.id)
    ).all()
    if not pending:
        return
    last = session.scalar(select(func.max(EvidenceOutbox.seq)))
    found = [
        e
        for e in writer.events(after_seq=None if last is None else int(last))
        if e["event"]["type"] in WRITER_ONLY
    ]
    for row, event in zip(pending, found, strict=False):
        evidence.record_append(
            session,
            row.id,
            event["seq"],
            event["epoch"],
            event["event"]["prev_hash"],
            event["event_hash"],
        )


def drain(db: Database, writer: WriterClient, batch: int = BATCH) -> int:
    """Send up to ``batch`` pending events; return how many were appended. Raises
    ``WriterUnavailable`` when the writer cannot be reached; nothing is lost then."""
    with db.session() as session:
        identity = lookups.store_identity(session)
        if identity is None:
            return 0  # no store yet: nothing can be chained
        status = writer.status()
        if status.get("stream_id") is None:
            status = writer.init_stream(identity[0])
        _adopt_writer_events(session, writer)
        rows = session.scalars(
            select(EvidenceOutbox)
            .where(EvidenceOutbox.seq.is_(None), EvidenceOutbox.type.not_in(WRITER_ONLY))
            # The chain must start with store_created (genesis), but first run queues events
            # before the store exists (a model downloaded in setup step 3, the store created in
            # step 5): send store_created first, the rest in the order they were recorded.
            .order_by(case((EvidenceOutbox.type == "store_created", 0), else_=1), EvidenceOutbox.id)
            .limit(batch)
        ).all()
        if rows:
            reply = writer.append([_intent(r) for r in rows])
            receipts = {r["intent_id"]: r for r in reply["receipts"]}
            for row in rows:
                r = receipts[row.event_id]
                evidence.record_append(
                    session, row.id, r["seq"], r["epoch"], r["prev_hash"], r["event_hash"]
                )
            status = reply["status"]
        _mirror_checkpoints(session, writer)
        evidence.record_writer_report(
            session,
            status.get("device_id"),
            status.get("epoch"),
            status.get("prior_tip_hash"),
            status.get("tip_hash"),
        )
        session.commit()
        return len(rows)


def shutdown_checkpoint(db: Database, writer: WriterClient) -> None:
    """IPC-52: flush what is queued, then have the writer sign the tip."""
    drain(db, writer)
    writer.checkpoint()
    with db.session() as session:
        _mirror_checkpoints(session, writer)
        session.commit()


async def run(db: Database, writer: WriterClient, components: Components) -> None:
    """Background loop for the app's lifetime. A writer that does not answer marks the
    component failed (shown in Settings > Health); events stay pending and are retried."""
    while True:
        try:
            sent = await asyncio.to_thread(drain, db, writer)
            components.evidence_writer = ComponentState.OK
        except WriterUnavailable as exc:
            if components.evidence_writer is not ComponentState.FAILED:
                log_event(log, "writer_unavailable", error_code=exc.code, status=exc.status)
            components.evidence_writer = ComponentState.FAILED
            sent = 0
        except Exception as exc:  # e.g. the store is locked: retry later
            log_event(log, "pump_error", error_code=type(exc).__name__)
            components.evidence_writer = ComponentState.DEGRADED
            sent = 0
        await asyncio.sleep(0 if sent >= BATCH else INTERVAL_S)
