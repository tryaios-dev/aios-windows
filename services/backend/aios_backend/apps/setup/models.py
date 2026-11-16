"""Tables only setup uses. Both hold one row (id 1).

``store_identity``: created once with the store; ids only, never a key (keys live in the OS
keystore and the wrapped Recovery Package).
``setup_state``: whether first run is done, when the last restore happened, and where and when
the last backup was made (decision D3).

After changing a table: `uv run aios-backend makemigrations -m "..."` and review the file.
"""

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, CheckConstraint, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from db.base import ID, Base, Timestamps, UTCDateTime

SINGLE_ROW = 1


class StoreIdentity(Timestamps, Base):
    __tablename__ = "store_identity"
    __table_args__ = (CheckConstraint("id = 1", name="single_row"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=SINGLE_ROW)
    stream_id: Mapped[str] = mapped_column(ID)
    signing_key_id: Mapped[str] = mapped_column(String(64))
    package_id: Mapped[str] = mapped_column(ID)


class SetupState(Timestamps, Base):
    __tablename__ = "setup_state"
    __table_args__ = (CheckConstraint("id = 1", name="single_row"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=SINGLE_ROW)
    first_run_complete: Mapped[bool] = mapped_column(Boolean, default=False)
    completed_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    default_project_id: Mapped[str | None] = mapped_column(ID)
    last_restore_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    restore_count: Mapped[int] = mapped_column(Integer, default=0)
    # The folder the person chose for backups (Settings > Backup and recovery); null until chosen.
    backup_location: Mapped[str | None] = mapped_column(String(1024))
    last_backup_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
    last_backup_size: Mapped[int | None] = mapped_column(BigInteger)
    # When the current recovery key was shown: at first run, and again for a new key (decision D4).
    recovery_key_issued_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
