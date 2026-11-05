"""Search rules: at least two characters, newest first, at most 60 hits, a snippet around the match."""

import re

from sqlalchemy.orm import Session

from aios_backend.apps.search import repository as repo
from aios_backend.apps.search.schemas import SearchHit

MIN_QUERY = 2
MAX_HITS = 60


def snippet(content: str, query: str) -> str:
    idx = content.lower().find(query.lower())
    idx = max(idx, 0)
    start = max(0, idx - 70)
    end = min(len(content), idx + len(query) + 90)
    text = re.sub(r"\s+", " ", content[start:end])
    return ("…" if start > 0 else "") + text + ("…" if end < len(content) else "")


def search(session: Session, q: str) -> list[SearchHit]:
    query = q.strip()
    if len(query) < MIN_QUERY:
        return []
    return [
        SearchHit(
            message_id=m.id,
            conversation_id=m.conversation_id,
            project_id=project_id,
            snippet=snippet(m.content, query),
            created_at=m.created_at,
            role=m.role,
        )
        for m, project_id in repo.matching_messages(session, query, MAX_HITS)
    ]
