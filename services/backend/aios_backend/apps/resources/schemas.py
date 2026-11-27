"""Request and response bodies of the resources app."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class LinkIn(BaseModel):
    # Sent by Electron main, never by the window (invariant 3): main reads it from the clipboard.
    # None: use the key an operator stored on this computer (``aios-backend resource key``).
    api_key: str | None = Field(default=None, min_length=16, max_length=512, repr=False)
    monthly_limit: float | None = Field(default=None, ge=0, le=100_000)


class ResourceModelOut(BaseModel):
    """One model of a linked resource: what the person can pick in a conversation, and what it
    used this calendar month (UTC) at the company's price for it."""

    id: str
    name: str
    tokens_in: int = 0
    tokens_out: int = 0
    uses: int = 0  # answers it has written
    # The price per million tokens it is charged at (its own, else its resource's); None: not set.
    price_in: float | None = None
    price_out: float | None = None
    spent: float = 0.0  # this month


class LinkedResourceOut(BaseModel):
    id: str
    name: str
    model_id: str
    linked_at: datetime
    monthly_limit: float | None
    spent: float  # this month: tokens x the company's price (0 while no price is set)
    uses: int  # answers the resource has written
    # This calendar month (UTC): tokens read and written, as the provider reported them.
    tokens_in: int = 0
    tokens_out: int = 0
    # The company's price per million tokens; None: not set.
    price_in: float | None = None
    price_out: float | None = None
    # "chat" (a cloud AI model to talk to) or "video" (makes videos in Images & video). For a
    # video resource ``uses`` counts videos made, ``price_in`` is the price per second of video.
    kind: Literal["chat", "video"] = "chat"
    videos: int = 0  # this month
    video_seconds: float = 0.0  # this month
    # A chat resource's models (the first is its default), each with its own usage and price.
    models: list[ResourceModelOut] = []
