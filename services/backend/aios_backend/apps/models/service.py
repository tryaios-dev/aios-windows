"""Model rules: only catalogue models are installed, byte for byte; deleting the default clears it.

Offline import (MVP 4.1, M-07): the user picks a .gguf file; it is installed only if its size
and SHA-256 equal a catalogue entry, then copied into the models folder. Download from the
mirror and the engine (llama-server, benchmark) are not part of this build.
"""

import os
import shutil
from pathlib import Path

from sqlalchemy.orm import Session

from aios_backend.apps.models import catalogue, hardware
from aios_backend.apps.models import repository as repo
from aios_backend.apps.models.models import InstalledModel
from aios_backend.apps.models.schemas import (
    CatalogueEntryOut,
    CatalogueOut,
    DeviationApproval,
    EngineStatus,
    Gpu,
    HardwareOut,
    InstalledModelOut,
)
from aios_backend.config import Settings
from aios_backend.errors import AppError, not_found
from db.base import utcnow


def _entry_out(e: catalogue.Entry) -> CatalogueEntryOut:
    review = DeviationApproval(**e.deviation_review) if e.deviation_review else None
    return CatalogueEntryOut(
        entry_id=e.id,
        name=e.name,
        tier=e.tier,
        upstream_model=e.upstream_model,
        upstream_revision=e.upstream_revision,
        source_weight_digest=e.source_weight_digest,
        conversion_tool=e.conversion_tool,
        conversion_version=e.conversion_version,
        quantisation_method=e.quantisation_method,
        artifact_digest=e.artifact_digest,
        size_bytes=e.size_bytes,
        file_name=e.file_name,
        licence=e.licence,
        licence_reference=e.licence_reference,
        publisher=e.publisher,
        pipeline=e.pipeline,
        deviation_approval=review,
        context_length=e.context_length,
        min_ram_gb=e.min_ram_gb,
        min_vram_gb=e.min_vram_gb,
        mirror_url=e.mirror_url,
        description=e.description,
    )


def _model_out(m: InstalledModel) -> InstalledModelOut:
    return InstalledModelOut(
        id=m.id,
        catalogue_entry_id=m.id,
        name=m.name,
        file_path=m.file_path,
        artifact_digest=m.artifact_digest,
        size_bytes=m.size_bytes,
        context_length=m.context_length,
        licence=m.licence,
        tier=m.tier,
        installed_at=m.installed_at,
        source=m.source,
    )


def get_catalogue() -> CatalogueOut:
    return CatalogueOut(
        version=catalogue.version(),
        signed=False,
        entries=[_entry_out(e) for e in catalogue.entries()],
    )


def list_installed(session: Session) -> list[InstalledModelOut]:
    return [_model_out(m) for m in repo.installed(session)]


def _match(path: Path, entry_id: str | None) -> catalogue.Entry:
    """The catalogue entry this file is, checked by size first (cheap), then SHA-256."""
    size = path.stat().st_size
    if entry_id is not None:
        entry = catalogue.find(entry_id)
        if entry is None:
            raise not_found("catalogue_entry")
        candidates = [entry]
    else:
        candidates = [e for e in catalogue.entries() if e.size_bytes == size]
    candidates = [e for e in candidates if e.size_bytes == size]
    if not candidates:
        raise AppError("size_mismatch", 422)
    digest = catalogue.sha256_file(path)
    for entry in candidates:
        if entry.artifact_digest == digest:
            return entry
    raise AppError("digest_mismatch", 422)


def _copy_into(src: Path, folder: Path, file_name: str) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / file_name
    if src.resolve() == target.resolve():
        return target
    tmp = target.with_name(target.name + ".part")
    shutil.copyfile(src, tmp)
    os.replace(tmp, target)
    return target


def import_model(
    session: Session, settings: Settings, path_text: str, entry_id: str | None
) -> InstalledModelOut:
    path = Path(path_text)
    if not path.is_absolute() or not path.is_file():
        raise AppError("invalid_path", 400)
    if path.suffix.lower() != ".gguf":
        raise AppError("not_gguf", 422)
    entry = _match(path, entry_id)
    if repo.get(session, entry.id) is not None:
        raise AppError("model_installed", 409)
    target = _copy_into(path, settings.models_dir, entry.file_name)
    model = InstalledModel(
        id=entry.id,
        name=entry.name,
        tier=entry.tier,
        file_path=str(target),
        artifact_digest=entry.artifact_digest,
        size_bytes=entry.size_bytes,
        context_length=entry.context_length,
        licence=entry.licence,
        source="offline",
        installed_at=utcnow(),
    )
    repo.add(session, model)
    repo.record_event(
        session,
        "model_installed",
        body={
            "model_id": entry.id,
            "artifact_sha256": entry.artifact_digest,
            "size_bytes": entry.size_bytes,
            "source": "offline",
        },
    )
    return _model_out(model)


def delete_model(session: Session, settings: Settings, model_id: str) -> None:
    model = repo.get(session, model_id)
    if model is None:
        raise not_found("model")
    file = Path(model.file_path)
    # Only files AIOS copied into its own models folder are removed from disk.
    if file.is_file() and file.resolve().parent == settings.models_dir.resolve():
        file.unlink()
    if repo.default_model_id(session) == model_id:
        repo.clear_default_model(session)
    repo.delete(session, model)
    repo.record_event(
        session,
        "model_deleted",
        body={"model_id": model_id, "size_bytes": model.size_bytes},
    )


def get_hardware(session: Session, settings: Settings, refresh: bool) -> HardwareOut:
    row = repo.hardware(session)
    if row is None or refresh:
        hw = hardware.detect(settings.models_dir)
        row = repo.save_hardware(
            session,
            {
                "cpu": hw.cpu[:200],
                "cores": hw.cores,
                "ram_gb": hw.ram_gb,
                "gpu_name": hw.gpu_name[:200] if hw.gpu_name else None,
                "vram_gb": hw.vram_gb,
                "gpu_driver_ok": hw.gpu_driver_ok,
                "free_disk_gb": hw.free_disk_gb,
                "os": hw.os[:200],
                "checked_at": utcnow(),
            },
        )
    gpu = (
        Gpu(name=row.gpu_name, vram_gb=row.vram_gb or 0, driver_ok=row.gpu_driver_ok)
        if row.gpu_name
        else None
    )
    tier = hardware.recommended_tier(row.ram_gb, row.free_disk_gb, row.vram_gb)
    return HardwareOut(
        cpu=row.cpu,
        cores=row.cores,
        ram_gb=row.ram_gb,
        gpu=gpu,
        free_disk_gb=row.free_disk_gb,
        os=row.os,
        recommended_tier=tier,
        checked_at=row.checked_at,
    )


def engine_status(session: Session) -> EngineStatus:
    count = len(repo.installed(session))
    return EngineStatus(state="not_built" if count else "no_model", installed=count)


def download(entry_id: str) -> None:
    if catalogue.find(entry_id) is None:
        raise not_found("catalogue_entry")
    # The mirror host in the network allowlist is a placeholder until B-06 records the real one.
    raise AppError("mirror_unavailable", 503)
