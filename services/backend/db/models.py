"""Tables in chats.db. After changing a model: `uv run aios-backend makemigrations -m "..."`."""

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base, Timestamps


class Preference(Timestamps, Base):
    """User preferences as key -> JSON text. The first table; apps add their own."""

    __tablename__ = "preferences"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
