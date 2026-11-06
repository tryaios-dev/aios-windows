"""chats.db access for installed models and the hardware profile."""

from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from aios_backend.apps.models.models import (
    SINGLE_ROW,
    Benchmark,
    EngineFallback,
    HardwareProfile,
    InstalledModel,
    ModelDownload,
)
from db import lookups, outbox

record_event = outbox.record
default_model_id = lookups.default_model_id
clear_default_model = lookups.clear_default_model
setting_flag = lookups.setting_flag
record_catalogue_check = lookups.record_catalogue_check
last_catalogue_version = lookups.catalogue_version


def installed(session: Session) -> Sequence[InstalledModel]:
    return session.scalars(select(InstalledModel).order_by(InstalledModel.installed_at)).all()


def get(session: Session, model_id: str) -> InstalledModel | None:
    return session.get(InstalledModel, model_id)


def add(session: Session, row: InstalledModel | Benchmark) -> None:
    session.add(row)
    session.flush()


def delete(session: Session, model: InstalledModel) -> None:
    session.delete(model)
    session.flush()


def hardware(session: Session) -> HardwareProfile | None:
    return session.get(HardwareProfile, SINGLE_ROW)


def save_hardware(session: Session, values: dict[str, object]) -> HardwareProfile:
    row = hardware(session)
    if row is None:
        row = HardwareProfile(id=SINGLE_ROW, **values)
        session.add(row)
    else:
        for key, value in values.items():
            setattr(row, key, value)
    session.flush()
    return row


def latest_benchmark(session: Session) -> Benchmark | None:
    return session.scalars(select(Benchmark).order_by(Benchmark.id.desc()).limit(1)).first()


# ------------------------------------------------------------------ downloads
def downloads(session: Session) -> Sequence[ModelDownload]:
    return session.scalars(select(ModelDownload).order_by(ModelDownload.started_at)).all()


def save_download(session: Session, entry_id: str, values: dict[str, object]) -> None:
    row = session.get(ModelDownload, entry_id)
    if row is None:
        session.add(ModelDownload(entry_id=entry_id, **values))
    else:
        for key, value in values.items():
            setattr(row, key, value)
    session.flush()


def delete_download(session: Session, entry_id: str) -> None:
    row = session.get(ModelDownload, entry_id)
    if row is not None:
        session.delete(row)
        session.flush()


# ------------------------------------------------------------------ engine fallbacks
def fallback_at(session: Session, occurred_at: datetime) -> EngineFallback | None:
    stmt = select(EngineFallback).where(EngineFallback.occurred_at == occurred_at)
    return session.scalars(stmt).first()


def add_fallback(session: Session, row: EngineFallback) -> EngineFallback:
    session.add(row)
    session.flush()
    return row


def acknowledge_fallbacks(session: Session, when: datetime) -> None:
    stmt = select(EngineFallback).where(EngineFallback.acknowledged_at.is_(None))
    for row in session.scalars(stmt):
        row.acknowledged_at = when
    session.flush()
