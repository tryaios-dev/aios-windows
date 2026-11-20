"""Tables only the resources app uses."""

from sqlalchemy import Float, String
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base, Timestamps


class LinkedResource(Timestamps, Base):
    """A resource linked on the Resources page. Its API key is not here: it lives only in the OS
    key store (``aios_backend.linked_config.key_name``, invariant 3)."""

    __tablename__ = "linked_resources"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    # Monthly spending limit in euros; None: no limit was set.
    monthly_limit: Mapped[float | None] = mapped_column(Float, nullable=True)
