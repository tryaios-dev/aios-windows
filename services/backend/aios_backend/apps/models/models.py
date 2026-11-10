"""Tables only the models app uses.

``installed_models``: one row per verified GGUF file on this machine. The id is the catalogue
entry id, which is also the ``model_id`` conversations and evidence use.
``hardware_profile``: the last hardware check (one row, id 1).
``benchmarks``: results of the engine benchmark, newest last (Settings > Hardware, Models).
``model_downloads``: one row per download not yet finished, so a paused or interrupted download
is still listed (and resumes from its ``.download`` file) after AIOS restarts.
``engine_fallbacks``: each time the GPU build failed and the engine fell back to the CPU build,
and whether the user has dismissed the notice (it stays dismissed after a restart).

After changing a table: `uv run aios-backend makemigrations -m "..."` and review the file.
"""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Float,
    Integer,
    String,
    UniqueConstraint,
)
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


class Benchmark(Base):
    __tablename__ = "benchmarks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    model_id: Mapped[str] = mapped_column(String(64))
    engine_build: Mapped[str] = mapped_column(String(16))  # cpu | vulkan
    tokens_per_second: Mapped[float] = mapped_column(Float)
    time_to_first_token_ms: Mapped[int] = mapped_column(Integer)
    run_at: Mapped[datetime] = mapped_column(UTCDateTime)


class ModelDownload(Timestamps, Base):
    __tablename__ = "model_downloads"

    entry_id: Mapped[str] = mapped_column(String(64), primary_key=True)  # catalogue entry id
    status: Mapped[str] = mapped_column(String(16))  # queued | downloading | paused | failed
    received_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    total_bytes: Mapped[int] = mapped_column(BigInteger)
    error: Mapped[str | None] = mapped_column(String(64))  # error code, never a message
    started_at: Mapped[datetime] = mapped_column(UTCDateTime)


class EngineFallback(Base):
    __tablename__ = "engine_fallbacks"
    __table_args__ = (UniqueConstraint("occurred_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    occurred_at: Mapped[datetime] = mapped_column(UTCDateTime)
    from_build: Mapped[str] = mapped_column(String(16))  # vulkan
    to_build: Mapped[str] = mapped_column(String(16))  # cpu
    acknowledged_at: Mapped[datetime | None] = mapped_column(UTCDateTime)
