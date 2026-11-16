"""Request and response bodies for the catalogue, installed models and hardware.

Field names follow the UI types CatalogueEntry, InstalledModel and Hardware
(apps/ui/src/lib/types.ts).
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Tier = Literal["small", "medium", "large"]


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


class BenchmarkOut(BaseModel):
    model_id: str
    engine: Literal["cpu", "vulkan"]
    tokens_per_second: float
    time_to_first_token_ms: int
    run_at: datetime


class HardwareOut(BaseModel):
    cpu: str
    cores: int
    ram_gb: int
    gpu: Gpu | None
    free_disk_gb: int
    os: str
    recommended_tier: Tier | None
    # The one model AIOS suggests for this machine (catalogue entry id), or None.
    recommended_entry_id: str | None = None
    checked_at: datetime
    benchmark: BenchmarkOut | None = None  # the latest run on this machine


EngineStateName = Literal[
    "not_built",  # this build has no local engine
    "no_model",
    "not_started",
    "loading",
    "ready",
    "generating",
    "idle_unloaded",
    "failed",
]
Build = Literal["cpu", "vulkan"]


class FallbackOut(BaseModel):
    occurred_at: datetime
    from_build: Build
    to_build: Build
    acknowledged: bool


class EngineStatus(BaseModel):
    """State of the local engine (llama-server). ``not_built`` until the engine module exists."""

    state: EngineStateName
    installed: int
    build: Build | None = None
    loaded_model_id: str | None = None
    fallback: FallbackOut | None = None


class ModelChoiceIn(BaseModel):
    """``model_id``: an installed model; omitted -> the default model, else the first installed."""

    model_id: str | None = Field(default=None, max_length=64)


class ModelChecks(BaseModel):
    """What the setup Verified step shows."""

    digest_matches: bool  # the installed file's SHA-256 equals the catalogue entry
    provenance_complete: bool  # upstream, conversion and quantisation are all recorded
    pipeline: Literal["own", "third-party"]
    deviation_approval: DeviationApproval | None


class InstalledModelDetail(InstalledModelOut):
    checks: ModelChecks


DownloadStatus = Literal["queued", "downloading", "paused", "verifying", "failed", "done"]


class DownloadState(BaseModel):
    entry_id: str
    status: DownloadStatus
    received_bytes: int
    total_bytes: int
    speed_bps: int
    error: str | None
    started_at: datetime


class DownloadStart(BaseModel):
    entry_id: str = Field(min_length=1, max_length=64)


class CatalogueCheckIn(BaseModel):
    """``manual``: the user pressed "Check now", allowed even while the automatic check is off."""

    manual: bool = False


class CatalogueCheckOut(BaseModel):
    version: str
    changed: bool
    checked_at: datetime
