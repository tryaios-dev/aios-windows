"""Tables only search uses. It reads messages and conversations (db/models.py).

The search index is an SQLite FTS5 table with the trigram tokenizer, so a query of three or more
characters finds the same "contains" matches as before, without scanning every message. It lives
inside chats.db, so it is encrypted like everything else.

``message_search`` (FTS5, contentless: it stores no copy of the text) is created by migration 0006
with three triggers on ``messages`` that keep it current on every insert, edit and delete, by any
app. FTS5 needs integer row ids that never change, so ``search_entries`` gives each message one.
Alembic does not manage FTS tables; ``db/migrations/env.py`` skips them (``FTS_TABLE``).

After changing a table: `uv run aios-backend makemigrations -m "..."` and review the file.
"""

from sqlalchemy import Integer
from sqlalchemy.orm import Mapped, mapped_column

from db.base import ID, Base

FTS_TABLE = "message_search"


class SearchEntry(Base):
    __tablename__ = "search_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)  # rowid in message_search
    message_id: Mapped[str] = mapped_column(ID, unique=True)  # no FK: the triggers keep it in step
