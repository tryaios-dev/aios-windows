"""Tables in chats.db. After changing a model: `uv run aios-backend makemigrations -m "..."`.

These tables are shared: several apps read them (chat reads projects, search reads messages,
projects exports conversations), and apps never import each other, so the tables live here in
the top-level db package. Each app's own ``models.py`` holds tables only that app uses.

Field names follow MVP 9.1 and the UI types in ``apps/ui/src/lib/types.ts``.
"""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
)
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
    # Fields this version does not understand, kept from an imported Project Package and written
    # back on export (MVP 9.5), plus the original classification source of an imported item.
    extensions: Mapped[str] = mapped_column(Text, default="{}", server_default="{}")


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
    # Fields this version does not understand, kept from an imported Project Package and written
    # back on export (MVP 9.5), plus the original classification source of an imported item.
    extensions: Mapped[str] = mapped_column(Text, default="{}", server_default="{}")


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
    # Fields this version does not understand, kept from an imported Project Package and written
    # back on export (MVP 9.5), plus the original classification source of an imported item.
    extensions: Mapped[str] = mapped_column(Text, default="{}", server_default="{}")


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
    # Fields this version does not understand, kept from an imported Project Package (MVP 9.5).
    extensions: Mapped[str] = mapped_column(Text, default="{}", server_default="{}")


class Provider(Timestamps, Base):
    """Where a conversation can run (MVP 9.1): ``local`` (the engine on this device) and, behind
    the operator flag, ``company``. The API key is never here: ``credential_ref`` names the OS key
    store entry that holds it (FR-30)."""

    __tablename__ = "providers"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)  # local | company
    type: Mapped[str] = mapped_column(ENUM)  # local | company
    base_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    credential_ref: Mapped[str | None] = mapped_column(String(100), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)


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


class KnowledgeDoc(Timestamps, Base):
    """A document in My secure knowledge: an encrypted copy (chats.db is SQLCipher) and its text.

    Read by the knowledge app (add, list, remove) and by chat (a question asked with documents).
    The original file is never moved or changed; ``origin`` is the folder it is still in.
    """

    __tablename__ = "knowledge_docs"

    id: Mapped[str] = mapped_column(ID, primary_key=True)
    name: Mapped[str] = mapped_column(String(260))
    kind: Mapped[str] = mapped_column(String(32))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    pages: Mapped[int | None] = mapped_column(Integer, nullable=True)
    collection: Mapped[str] = mapped_column(String(260))
    origin: Mapped[str] = mapped_column(String(1024))
    status: Mapped[str] = mapped_column(String(16))  # ready | failed
    problem: Mapped[str | None] = mapped_column(String(300), nullable=True)
    text: Mapped[str] = mapped_column(Text, default="")
    data: Mapped[bytes] = mapped_column(LargeBinary)


class Skill(Timestamps, Base):
    """A skill added to the AI: one from the AIOS list or one from a ``.aios-skill`` file.

    Read by the skills app (add, switch, remove) and by chat (an enabled skill's instruction goes
    with every question). The instruction is kept here so chat never needs the skills app.
    """

    __tablename__ = "skills"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    line: Mapped[str] = mapped_column(String(300))
    detail: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(32))
    publisher: Mapped[str] = mapped_column(String(120))
    licence: Mapped[str] = mapped_column(String(64))
    open_source: Mapped[bool] = mapped_column(Boolean, default=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    version: Mapped[str] = mapped_column(String(32))
    uses: Mapped[str] = mapped_column(Text)  # a JSON list of plain sentences
    example: Mapped[str] = mapped_column(String(500))
    instruction: Mapped[str] = mapped_column(Text)
    own: Mapped[bool] = mapped_column(Boolean, default=False)  # added from a file
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class LinkedResource(Timestamps, Base):
    """A cloud AI model linked on the Resources page. Shared: the resources app links it and shows
    its usage, chat stops sending once its monthly limit is reached. Its API key is not here: it
    lives only in the OS key store (``aios_backend.linked_config.key_name``, invariant 3)."""

    __tablename__ = "linked_resources"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    # Monthly spending limit; None: no limit was set.
    monthly_limit: Mapped[float | None] = mapped_column(Float, nullable=True)
    # What the company charges per million tokens read (in) and written (out); None: not set,
    # only tokens are counted. Set by an operator (``aios-backend resource price``).
    price_in: Mapped[float | None] = mapped_column(Float, nullable=True)
    price_out: Mapped[float | None] = mapped_column(Float, nullable=True)
    # The chat models its key can use, as the provider listed them at link time: a JSON list of
    # model ids (None: not known; the resource's own models are offered).
    models: Mapped[str | None] = mapped_column(Text, nullable=True)


class LinkedModelPrice(Timestamps, Base):
    """What the company charges for one model of a linked resource (Claude Opus, GPT-6.2 Sol, ...),
    per million tokens read (in) and written (out). A model without a row is charged at its
    resource's price (``LinkedResource``). Set by an operator (``aios-backend resource price
    --model``); kept when the resource is unlinked and linked again."""

    __tablename__ = "linked_model_prices"

    model_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    resource_id: Mapped[str] = mapped_column(String(64))
    price_in: Mapped[float | None] = mapped_column(Float, nullable=True)
    price_out: Mapped[float | None] = mapped_column(Float, nullable=True)
