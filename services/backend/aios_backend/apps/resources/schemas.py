"""Request and response bodies of the resources app."""

from datetime import datetime

from pydantic import BaseModel, Field


class LinkIn(BaseModel):
    # Sent by Electron main, never by the window (invariant 3): main reads it from the clipboard.
    # None: use the key an operator stored on this computer (``aios-backend resource key``).
    api_key: str | None = Field(default=None, min_length=16, max_length=512, repr=False)
    monthly_limit: float | None = Field(default=None, ge=0, le=100_000)


class LinkedResourceOut(BaseModel):
    id: str
    name: str
    model_id: str
    linked_at: datetime
    monthly_limit: float | None
    spent: float  # not counted yet: always 0
    uses: int  # answers the resource has written
