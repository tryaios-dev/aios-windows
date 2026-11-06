"""Tables only the models app uses.

``installed_models``: one row per verified GGUF file on this machine. The id is the catalogue
entry id, which is also the ``model_id`` conversations and evidence use.
``hardware_profile``: the last hardware check (one row, id 1).

After changing a table: `uv run aios-backend makemigrations -m "..."` and review the file.
"""

from datetime import datetime

from sqlalchemy import BigInteger, Boolean, CheckConstraint, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from db.base import Base, Timestamps, UTCDateTime

SINGLE_ROW = 1


class InstalledModel(Timestamps, Base):
    __tablename__ = "installed_models"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # catalogue entry id
    name: Mapped[str] = mapped_column(String(200))
    tier: Mapped[str] = mapped_column(String(16))  # small | medium
    file_path: Mapped[str] = mapped_column(String(1024))
    artifact_digest: Mapped[str] = mapped_column(String(64))  # SHA-256 hex, checked at install
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    context_length: Mapped[int] = mapped_column(Integer)
    licence: Mapped[str] = mapped_column(String(64))
    source: Mapped[str] = mapped_column(String(16))  # download | offline
    installed_at: Mapped[datetime] = mapped_column(UTCDateTime)


class HardwareProfile(Timestamps, Base):
    __tablename__ = "hardware_profile"
    __table_args__ = (CheckConstraint("id = 1", name="single_row"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=SINGLE_ROW)
    cpu: Mapped[str] = mapped_column(String(200))
    cores: Mapped[int] = mapped_column(Integer)
    ram_gb: Mapped[int] = mapped_column(Integer)
    gpu_name: Mapped[str | None] = mapped_column(String(200))
    vram_gb: Mapped[int | None] = mapped_column(Integer)
    gpu_driver_ok: Mapped[bool] = mapped_column(Boolean, default=False)
    free_disk_gb: Mapped[int] = mapped_column(Integer)
    os: Mapped[str] = mapped_column(String(200))
    checked_at: Mapped[datetime] = mapped_column(UTCDateTime)
