"""Tables only the media app uses: the pictures and videos made for a project (R-7)."""

from datetime import datetime

from sqlalchemy import BigInteger, Float, ForeignKey, Integer, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from db.base import ID, Base, Timestamps, UTCDateTime

ENUM = String(16)


class MediaItem(Timestamps, Base):
    """One picture or video: what was asked, how the job went, and the file once it is done.

    The file is kept in chats.db, which SQLCipher encrypts. The prompt is kept like a message:
    in the encrypted store only, never in a log or in evidence (invariant 6).
    """

    __tablename__ = "media_items"

    id: Mapped[str] = mapped_column(ID, primary_key=True)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(ENUM)  # image | video
    model: Mapped[str] = mapped_column(String(64))
    prompt: Mapped[str] = mapped_column(Text)
    negative_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    frames: Mapped[int | None] = mapped_column(Integer, nullable=True)
    seed: Mapped[int] = mapped_column(BigInteger)
    status: Mapped[str] = mapped_column(ENUM)  # queued | running | done | failed | cancelled
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    position: Mapped[int | None] = mapped_column(Integer, nullable=True)
    remote_job_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(48), nullable=True)
    mime: Mapped[str | None] = mapped_column(String(32), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    data: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
