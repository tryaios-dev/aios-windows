"""chats.db access for search: messages whose text contains the query.

A plain substring match (``instr``) inside the encrypted database. Good for the data sizes of
one desktop; switch to an FTS5 index if search becomes slow.
"""

from collections.abc import Sequence

from sqlalchemy import Row, func, select
from sqlalchemy.orm import Session

from db.models import Conversation, Message


def matching_messages(session: Session, query: str, limit: int) -> Sequence[Row[Message, str]]:
    stmt = (
        select(Message, Conversation.project_id)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(func.instr(func.lower(Message.content), query.lower()) > 0)
        .order_by(Message.created_at.desc())
        .limit(limit)
    )
    return session.execute(stmt).all()
