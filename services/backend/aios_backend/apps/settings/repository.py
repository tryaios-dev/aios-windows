"""Settings in chats.db, as JSON values in the preferences table."""

import json

from sqlalchemy.orm import Session

from db.models import Preference

SAFE_MODE = "engine.safe_mode"


def get_bool(session: Session, key: str, default: bool) -> bool:
    row = session.get(Preference, key)
    if row is None:
        return default
    value = json.loads(row.value)
    return value if isinstance(value, bool) else default


def set_bool(session: Session, key: str, value: bool) -> None:
    row = session.get(Preference, key)
    if row is None:
        session.add(Preference(key=key, value=json.dumps(value)))
    else:
        row.value = json.dumps(value)
