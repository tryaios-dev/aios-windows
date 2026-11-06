"""Tables in chats.db. After changing a model: `uv run aios-backend makemigrations -m "..."`.

These tables are shared: several apps read them (chat reads projects, search reads messages,
projects exports conversations), and apps never import each other, so the tables live here in
the top-level db package. Each app's own ``models.py`` holds tables only that app uses.

Field names follow MVP 9.1 and the UI types in ``apps/ui/src/lib/types.ts``.
"""

from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from db.base import ID, Base, Timestamps, UTCDateTime, utcnow

ENUM = String(16)  # classification, provider, role, status: checked by the API schemas


class Project(Timestamps, Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(ID, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    classification: Mapped[str] = mapped_column(ENUM)
    classification_source: Mapped[str] = mapped_column(ENUM)  # project | import | review
    # A reviewed lower-class copy points at the project it was copied from (M-04).
    derived_from_project_id: Mapped[str | None] = mapped_column(ID, nullable=True)
    # Provenance of an imported project (Project Package v1, section 6.5).
    imported_project_id: Mapped[str | None] = mapped_column(ID, nullable=True)
    imported_package_id: Mapped[str | None] = mapped_column(ID, nullable=True)
    company_ai_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)


class Conversation(Timestamps, Base):
    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(ID, primary_key=True)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(500))
    classification_effective: Mapped[str] = mapped_column(ENUM)
    classification_source: Mapped[str] = mapped_column(ENUM)
    provider_mode: Mapped[str] = mapped_column(ENUM)
    current_provider: Mapped[str] = mapped_column(ENUM)
    model_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    last_message_preview: Mapped[str | None] = mapped_column(String(200), nullable=True)


class ProviderMove(Base):
    """A point where a conversation moved between Local and Company (drawn as a divider)."""

    __tablename__ = "provider_moves"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    to_provider: Mapped[str] = mapped_column(ENUM)
    at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (Index("ix_messages_conversation_position", "conversation_id", "position"),)

    id: Mapped[str] = mapped_column(ID, primary_key=True)
    conversation_id: Mapped[str] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"))
    position: Mapped[int] = mapped_column(Integer)  # order inside the conversation
    role: Mapped[str] = mapped_column(ENUM)  # user | assistant
    content: Mapped[str] = mapped_column(Text)
    classification_effective: Mapped[str] = mapped_column(ENUM)
    classification_source: Mapped[str] = mapped_column(ENUM)
    status: Mapped[str] = mapped_column(ENUM)  # complete | partial | error | stopped
    provider: Mapped[str] = mapped_column(ENUM)
    model_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    # Hiding-commitment nonces (Evidence Wire Format v1, section 8). Kept only in chats.db.
    input_nonce: Mapped[str | None] = mapped_column(String(43), nullable=True)
    output_nonce: Mapped[str | None] = mapped_column(String(43), nullable=True)
    # Outbox row of the inference event; null until the answer is recorded.
    evidence_outbox_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    previous_versions: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON list
    continued_from: Mapped[str | None] = mapped_column(ID, nullable=True)


class Summary(Base):
    __tablename__ = "summaries"

    id: Mapped[str] = mapped_column(ID, primary_key=True)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    covers_until_message_id: Mapped[str] = mapped_column(ID)
    content: Mapped[str] = mapped_column(Text)
    classification_effective: Mapped[str] = mapped_column(ENUM)
    classification_source: Mapped[str] = mapped_column(ENUM)
    model_id: Mapped[str] = mapped_column(String(100))
    provider: Mapped[str] = mapped_column(ENUM)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class EvidenceOutbox(Base):
    """Evidence events waiting for the evidence writer (CLAUDE.md invariant 5).

    The backend never opens evidence.db. It queues content-free event drafts here, inside the
    same transaction as the change they describe; the writer appends them to the hash chain
    exactly once and records the sequence number it assigned (``seq``). Until then an event is
    pending.
    """

    __tablename__ = "evidence_outbox"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_id: Mapped[str] = mapped_column(ID, unique=True)
    type: Mapped[str] = mapped_column(String(64), index=True)
    actor: Mapped[str] = mapped_column(ENUM)  # user | app
    time: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    project_id: Mapped[str | None] = mapped_column(ID, nullable=True, index=True)
    conversation_id: Mapped[str | None] = mapped_column(ID, nullable=True)
    body: Mapped[str] = mapped_column(Text)  # JSON object, content-free
    seq: Mapped[int | None] = mapped_column(Integer, nullable=True)  # set by the writer
    acknowledged_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
