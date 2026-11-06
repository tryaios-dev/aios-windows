"""Tables only settings uses.

``settings`` holds one row (id 1): the user's choices and the results of the update and
catalogue checks. Chat and projects read ``default_model_id`` through ``db.lookups`` (apps do not
import each other).

After changing a table: `uv run aios-backend makemigrations -m "..."` and review the file.
"""

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, CheckConstraint, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base, Timestamps, UTCDateTime

SINGLE_ROW = 1


class UserSettings(Timestamps, Base):
    __tablename__ = "settings"
    __table_args__ = (CheckConstraint("id = 1", name="single_row"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=SINGLE_ROW)
    update_check: Mapped[bool] = mapped_column(Boolean, default=True)
    catalogue_check: Mapped[bool] = mapped_column(Boolean, default=True)
    safe_mode_cpu: Mapped[bool] = mapped_column(Boolean, default=False)
    default_model_id: Mapped[str | None] = mapped_column(String(100))
    # Results of the checks. Null until a check has run.
    last_update_check: Mapped[datetime | None] = mapped_column(UTCDateTime)
    update_available_version: Mapped[str | None] = mapped_column(String(32))
    update_available_size: Mapped[int | None] = mapped_column(BigInteger)
    last_catalogue_check: Mapped[datetime | None] = mapped_column(UTCDateTime)
    catalogue_version: Mapped[str | None] = mapped_column(String(32))
