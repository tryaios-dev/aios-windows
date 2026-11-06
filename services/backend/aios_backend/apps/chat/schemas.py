"""Request and response bodies for conversations and messages (UI types Conversation, Message)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Classification = Literal["restricted", "internal", "public"]
ClassificationSource = Literal["project", "import", "review"]
Provider = Literal["local", "company"]


class ProviderMoveOut(BaseModel):
    to: Provider
    at: datetime


class ConversationOut(BaseModel):
    id: str
    project_id: str
    title: str
    classification_effective: Classification
    classification_source: ClassificationSource
    provider_mode: Provider
    current_provider: Provider
    model_id: str | None
    archived: bool
    created_at: datetime
    updated_at: datetime
    last_message_preview: str | None
    moves: list[ProviderMoveOut]


class ConversationCreate(BaseModel):
    title: str | None = Field(default=None, max_length=500)


class ConversationPatch(BaseModel):
    title: str | None = Field(default=None, max_length=500)
    archived: bool | None = None
    model_id: str | None = Field(default=None, max_length=100)


class ProviderChange(BaseModel):
    to: Provider
    confirmed: bool = False  # moving to Company always asks first (M-09)


class MessageOut(BaseModel):
    id: str
    conversation_id: str
    role: Literal["user", "assistant"]
    content: str
    classification_effective: Classification
    classification_source: ClassificationSource
    status: Literal["complete", "partial", "error", "stopped"]
    provider: Provider
    model_id: str | None
    prompt_tokens: int
    completion_tokens: int
    created_at: datetime
    evidence_pending: bool  # the writer has not appended the event yet
    evidence_seq: int | None
    previous_versions: list[str]
    continued_from: str | None


class SendIn(BaseModel):
    text: str = Field(min_length=1, max_length=200_000)


class Exchange(BaseModel):
    """The user's message and the answer it produced."""

    user: MessageOut | None
    assistant: MessageOut


class CompanyStatus(BaseModel):
    """The Company AI server as Settings > Network shows it. Never holds the API key."""

    reachable: bool
    base_url: str | None
    model_name: str | None
    checked_at: datetime


class ProvidersStatus(BaseModel):
    local_ready: bool
    company_enabled: bool
    company: CompanyStatus | None = None  # null while the operator flag is off


class GenerationOut(BaseModel):
    """Whether this conversation is answering right now (list dot, Stop button)."""

    generating: bool
    message_id: str | None
    phase: Literal["loading_engine", "preparing", "streaming"] | None
    provider: Provider | None


class ContinueIn(BaseModel):
    """Exactly one: the interrupted answer to continue, or the message that could not be sent."""

    partial_message_id: str | None = Field(default=None, max_length=64)
    text: str | None = Field(default=None, min_length=1, max_length=200_000)


class ContinueOut(BaseModel):
    conversation: ConversationOut
    user: MessageOut | None
    assistant: MessageOut
