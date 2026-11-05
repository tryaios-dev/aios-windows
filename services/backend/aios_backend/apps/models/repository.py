"""chats.db access for installed models and the hardware profile."""

from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from aios_backend.apps.models.models import SINGLE_ROW, HardwareProfile, InstalledModel
from db import lookups, outbox

record_event = outbox.record
default_model_id = lookups.default_model_id
clear_default_model = lookups.clear_default_model


def installed(session: Session) -> Sequence[InstalledModel]:
    return session.scalars(select(InstalledModel).order_by(InstalledModel.installed_at)).all()


def get(session: Session, model_id: str) -> InstalledModel | None:
    return session.get(InstalledModel, model_id)


def add(session: Session, model: InstalledModel) -> None:
    session.add(model)
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
