"""chats.db access for search: messages whose text contains the query.

Three or more characters: the FTS5 trigram index (``message_search``, apps/search/models.py),
which finds exactly the "contains" matches without reading every message. Shorter queries have
no trigram, so they fall back to a substring scan (``instr``).
"""

from collections.abc import Sequence

from sqlalchemy import Row, func, select, text
from sqlalchemy.orm import Session

from aios_backend.apps.search.models import SearchEntry
from db.models import Conversation, Message, Project

TRIGRAM = 3


def _phrase(query: str) -> str:
    """The query as one FTS5 phrase, so no character in it acts as an operator."""
    return '"' + query.replace('"', '""') + '"'


def matching_messages(
    session: Session,
    query: str,
    limit: int,
    project_id: str | None = None,
    role: str | None = None,
    include_archived: bool = True,
) -> Sequence[Row[Message, str]]:
    stmt = select(Message, Conversation.project_id).join(
        Conversation, Conversation.id == Message.conversation_id
    )
    if len(query) >= TRIGRAM:
        hits = select(SearchEntry.message_id).where(
            SearchEntry.id.in_(
                select(text("rowid"))
                .select_from(text("message_search"))
                .where(text("message_search MATCH :phrase"))
            )
        )
        stmt = stmt.where(Message.id.in_(hits)).params(phrase=_phrase(query))
    else:
        stmt = stmt.where(func.instr(func.lower(Message.content), query.lower()) > 0)
    if project_id is not None:
        stmt = stmt.where(Conversation.project_id == project_id)
    if role is not None:
        stmt = stmt.where(Message.role == role)
    if not include_archived:
        stmt = stmt.join(Project, Project.id == Conversation.project_id).where(
            Conversation.archived.is_(False), Project.archived.is_(False)
        )
    return session.execute(stmt.order_by(Message.created_at.desc()).limit(limit)).all()
