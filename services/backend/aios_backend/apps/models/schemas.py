"""Request and response bodies for the catalogue, installed models and hardware.

Field names follow the UI types CatalogueEntry, InstalledModel and Hardware
(apps/ui/src/lib/types.ts).
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Tier = Literal["small", "medium"]


class DeviationApproval(BaseModel):
    reviewer: str
    date: str
    quality_threshold_result: str


class CatalogueEntryOut(BaseModel):
    entry_id: str
    name: str
    tier: Tier
    upstream_model: str
    upstream_revision: str
    source_weight_digest: str | None
    conversion_tool: str
    conversion_version: str
    quantisation_method: str
    artifact_digest: str
    size_bytes: int
    file_name: str
    licence: str
    licence_reference: str
    publisher: str
    pipeline: Literal["own", "third-party"]
    deviation_approval: DeviationApproval | None
    context_length: int
    min_ram_gb: int
    min_vram_gb: int
    mirror_url: str
    description: str


class CatalogueOut(BaseModel):
    version: str
    signed: bool  # false until the signed catalogue exists (ticket I-01)
    entries: list[CatalogueEntryOut]


class InstalledModelOut(BaseModel):
    id: str
    catalogue_entry_id: str
    name: str
    file_path: str
    artifact_digest: str
    size_bytes: int
    context_length: int
    licence: str
    tier: Tier
    installed_at: datetime
    source: Literal["download", "offline"]


class ImportIn(BaseModel):
    """``path``: the .gguf file the user picked. ``entry_id``: the entry they chose it for."""

    path: str = Field(min_length=1, max_length=1024)
    entry_id: str | None = Field(default=None, max_length=64)


class Gpu(BaseModel):
    name: str
    vram_gb: int
    driver_ok: bool


class HardwareOut(BaseModel):
    cpu: str
    cores: int
    ram_gb: int
    gpu: Gpu | None
    free_disk_gb: int
    os: str
    recommended_tier: Tier | None
    checked_at: datetime


class EngineStatus(BaseModel):
    """The local engine (llama-server) is not part of this build yet."""

    state: Literal["not_built", "no_model"]
    installed: int
