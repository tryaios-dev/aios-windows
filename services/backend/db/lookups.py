"""Small reads and writes of one app's table by other apps, in plain SQL.

Apps never import each other, so an app that needs one value from another app's table uses
this module. Keep this list short; a value many apps need belongs in a shared table (db/models.py).
"""

from sqlalchemy import text
from sqlalchemy.orm import Session


def default_model_id(session: Session) -> str | None:
    """The default local model chosen in Settings (table of apps/settings)."""
    value = session.execute(text("SELECT default_model_id FROM settings WHERE id = 1")).scalar()
    return value if isinstance(value, str) else None


def clear_default_model(session: Session) -> None:
    """Called by the models app when the default model is deleted."""
    session.execute(text("UPDATE settings SET default_model_id = NULL WHERE id = 1"))
