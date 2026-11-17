"""Rows created the first time they are read: two requests at once must not fail.

At start the window asks for the setup status and the settings in parallel. Found by the
real-window test (M-03): both requests saw no row, both inserted, and the second answered 500
(IntegrityError). Here the race is made certain: the row is created by another session between
this session's read and its insert.
"""

from typing import Any

import pytest
from sqlalchemy.orm import Session

from aios_backend.apps.settings import repository as settings_repo
from aios_backend.apps.setup import repository as setup_repo
from db.session import Database


def _first_read_misses(session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    """The next ``session.get`` sees no row, as if it ran just before the other request's insert."""
    real = session.get
    calls = {"n": 0}

    def get(*args: Any, **kwargs: Any) -> Any:
        calls["n"] += 1
        return None if calls["n"] == 1 else real(*args, **kwargs)

    monkeypatch.setattr(session, "get", get)


@pytest.mark.parametrize(
    "read",
    [setup_repo.state, settings_repo.load],
    ids=["setup_state", "settings"],
)
def test_a_row_created_meanwhile_by_another_request_is_used(
    db: Database, monkeypatch: pytest.MonkeyPatch, read: Any
) -> None:
    with db.session() as other:
        read(other)
        other.commit()
    with db.session() as session:
        _first_read_misses(session, monkeypatch)
        row = read(session)
        session.commit()
    assert row is not None
