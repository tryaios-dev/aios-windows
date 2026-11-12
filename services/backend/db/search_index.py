"""Rebuild the full-text search index from ``messages`` (H-02 repair command).

The index (``message_search``, FTS5, contentless) and its row map (``search_entries``) are
derived data: triggers keep them in step with ``messages``. If the index is ever damaged, it is
dropped and built again from the messages, which are the only source of truth. Contentless FTS5
has no ``rebuild`` command, so the table is recreated with the same definition as migration 0006.
"""

from sqlalchemy import text

from db.session import Database

CREATE = (
    "CREATE VIRTUAL TABLE message_search USING fts5(content, tokenize = 'trigram', content = '')"
)


def rebuild(db: Database) -> int:
    """Return how many messages were indexed."""
    with db.engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS message_search"))
        conn.execute(text(CREATE))
        conn.execute(text("DELETE FROM search_entries"))
        conn.execute(text("INSERT INTO search_entries (message_id) SELECT id FROM messages"))
        conn.execute(
            text(
                "INSERT INTO message_search (rowid, content) SELECT e.id, m.content"
                " FROM search_entries e JOIN messages m ON m.id = e.message_id"
            )
        )
        return int(conn.execute(text("SELECT count(*) FROM search_entries")).scalar() or 0)
