"""SPIKE-D04: request body in the OpenAI chat-completions shape, so the week-2 chat screen
(K-01) can stream from this endpoint until the gateway (G-01) replaces it."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(max_length=32_000)


class ChatCompletionRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")  # OpenAI clients send more fields

    messages: list[ChatMessage] = Field(min_length=1, max_length=64)
    max_tokens: int = Field(default=512, ge=1, le=2048)
