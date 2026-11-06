"""Response body for search (UI type SearchHit)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class SearchHit(BaseModel):
    message_id: str
    conversation_id: str
    project_id: str
    snippet: str
    created_at: datetime
    role: Literal["user", "assistant"]
