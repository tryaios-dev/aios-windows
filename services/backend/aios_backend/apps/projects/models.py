"""Tables only projects uses. Projects, conversations, messages and summaries are shared tables
(db/models.py): chat and search read them too.

``project_packages``: every Project Package written from or read into a project (export and
import history). An import of a package that was imported before is flagged with a warning.
Ids, counts and digests only; never a title or message.

After changing a table: `uv run aios-backend makemigrations -m "..."` and review the file.
"""

from datetime import datetime

from sqlalchemy import BigInteger, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from db.base import ID, Base, UTCDateTime, utcnow


class ProjectPackage(Base):
    __tablename__ = "project_packages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    direction: Mapped[str] = mapped_column(String(8))  # export | import
    package_id: Mapped[str] = mapped_column(ID, index=True)
    file_name: Mapped[str] = mapped_column(String(255))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    checksum: Mapped[str] = mapped_column(String(64))  # SHA-256 hex of the package file
    conversations: Mapped[int] = mapped_column(Integer)
    messages: Mapped[int] = mapped_column(Integer)
    summaries: Mapped[int] = mapped_column(Integer)
    evidence_outbox_id: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
