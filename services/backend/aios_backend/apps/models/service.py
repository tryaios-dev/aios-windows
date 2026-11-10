"""Model rules: only catalogue models are installed, byte for byte; deleting the default clears it.

Offline import (MVP 4.1, M-07): the user picks a .gguf file; it is installed only if its size
and SHA-256 equal a catalogue entry, then copied into the models folder. A download from the
mirror ends in the same check. The mirror (``mirror.py``) and the local engine (``engine.py``)
are seams: ``None`` in this build, so those endpoints answer ``503`` until they exist.
"""

import os
import shutil
from collections.abc import Sequence
from pathlib import Path

from sqlalchemy.orm import Session

from aios_backend.apps.models import catalogue, hardware
from aios_backend.apps.models import repository as repo
from aios_backend.apps.models.downloads import Downloads, Job
from aios_backend.apps.models.engine import LocalEngine
from aios_backend.apps.models.mirror import ModelMirror
from aios_backend.apps.models.models import Benchmark, EngineFallback, InstalledModel
from aios_backend.apps.models.schemas import (
    BenchmarkOut,
    CatalogueCheckOut,
    CatalogueEntryOut,
    CatalogueOut,
    DeviationApproval,
    DownloadState,
    EngineStatus,
    FallbackOut,
    Gpu,
    HardwareOut,
    InstalledModelDetail,
    InstalledModelOut,
    ModelChecks,
)
from aios_backend.components import Components, ComponentState
from aios_backend.config import Settings
from aios_backend.errors import AppError, not_found
from aios_backend.runtime import Generations
from db.base import utcnow
from db.session import Database

DOWNLOAD_SUFFIX = ".download"


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
    return _model_out(_install(session, entry, target, "offline"))


def _install(session: Session, entry: catalogue.Entry, target: Path, source: str) -> InstalledModel:
    model = InstalledModel(
        id=entry.id,
        name=entry.name,
        tier=entry.tier,
        file_path=str(target),
        artifact_digest=entry.artifact_digest,
        size_bytes=entry.size_bytes,
        context_length=entry.context_length,
        licence=entry.licence,
        source=source,
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
            "source": source,
        },
    )
    return model


def get_model(session: Session, model_id: str) -> InstalledModelDetail:
    """One installed model with the checks the setup Verified step shows."""
    model = repo.get(session, model_id)
    if model is None:
        raise not_found("model")
    entry = catalogue.find(model.id)
    review = (
        DeviationApproval(**entry.deviation_review) if entry and entry.deviation_review else None
    )
    provenance = bool(
        entry
        and entry.upstream_model
        and entry.upstream_revision
        and entry.conversion_tool
        and entry.quantisation_method
        and (entry.pipeline == "own" or review is not None)
    )
    checks = ModelChecks(
        digest_matches=entry is not None and entry.artifact_digest == model.artifact_digest,
        provenance_complete=provenance,
        pipeline="third-party" if entry and entry.pipeline == "third-party" else "own",
        deviation_approval=review,
    )
    return InstalledModelDetail(**_model_out(model).model_dump(), checks=checks)


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
    bench = repo.latest_benchmark(session)
    return HardwareOut(
        benchmark=_benchmark_out(bench) if bench else None,
        cpu=row.cpu,
        cores=row.cores,
        ram_gb=row.ram_gb,
        gpu=gpu,
        free_disk_gb=row.free_disk_gb,
        os=row.os,
        recommended_tier=tier,
        checked_at=row.checked_at,
    )


# ------------------------------------------------------------------ engine
def _benchmark_out(b: Benchmark) -> BenchmarkOut:
    return BenchmarkOut(
        model_id=b.model_id,
        engine="vulkan" if b.engine_build == "vulkan" else "cpu",
        tokens_per_second=b.tokens_per_second,
        time_to_first_token_ms=b.time_to_first_token_ms,
        run_at=b.run_at,
    )


COMPONENT_STATES = {
    ComponentState.NOT_STARTED: "not_started",
    ComponentState.STARTING: "loading",
    ComponentState.OK: "ready",
    ComponentState.DEGRADED: "ready",
    ComponentState.FAILED: "failed",
}


def _from_components(
    components: Components, installed: Sequence[InstalledModel], busy: bool
) -> EngineStatus:
    """The process manager's state, as /health reports it, in the shape of EngineStatus."""
    if not installed:
        state = "no_model"
    elif components.engine_idle_unloaded:
        state = "idle_unloaded"
    else:
        state = COMPONENT_STATES[components.engine]
        if state == "ready" and busy:
            state = "generating"
    build = components.engine_build if components.engine_build in ("cpu", "vulkan") else None
    loaded = next(
        (m.id for m in installed if Path(m.file_path).name == components.engine_model), None
    )
    return EngineStatus(
        state=state,
        installed=len(installed),
        build=build,
        loaded_model_id=loaded,
    )


def engine_status(
    session: Session,
    engine: LocalEngine | None,
    generations: Generations | None = None,
    components: Components | None = None,
) -> EngineStatus:
    installed = repo.installed(session)
    count = len(installed)
    if engine is None:
        if components is not None:
            busy = generations is not None and generations.busy()
            return _from_components(components, installed, busy)
        return EngineStatus(state="not_built" if count else "no_model", installed=count)
    current = engine.state()
    state = current.state
    if count == 0:
        state = "no_model"
    elif state == "ready" and generations is not None and generations.busy():
        state = "generating"
    fallback = None
    if current.fallback:
        # Recorded once, so a dismissed notice stays dismissed after a restart.
        fb = current.fallback
        row = repo.fallback_at(session, fb.occurred_at) or repo.add_fallback(
            session,
            EngineFallback(
                occurred_at=fb.occurred_at,
                from_build=fb.from_build,
                to_build=fb.to_build,
                acknowledged_at=utcnow() if fb.acknowledged else None,
            ),
        )
        fallback = FallbackOut(
            occurred_at=fb.occurred_at,
            from_build=fb.from_build,
            to_build=fb.to_build,
            acknowledged=fb.acknowledged or row.acknowledged_at is not None,
        )
    return EngineStatus(
        state=state,
        installed=count,
        build=current.build,
        loaded_model_id=current.loaded_model_id,
        fallback=fallback,
    )


def _pick_model(session: Session, model_id: str | None) -> InstalledModel:
    """The model asked for, else the default model, else the first installed one."""
    if model_id is not None:
        model = repo.get(session, model_id)
        if model is None:
            raise not_found("model")
        return model
    default = repo.default_model_id(session)
    found = repo.get(session, default) if default else None
    if found is not None:
        return found
    installed = repo.installed(session)
    if not installed:
        raise AppError("no_model", 409)
    return installed[0]


def start_engine(
    session: Session,
    engine: LocalEngine | None,
    generations: Generations,
    model_id: str | None,
) -> EngineStatus:
    """Start the engine and load a model (setup Engine step). Safe mode forces the CPU build."""
    model = _pick_model(session, model_id)
    if engine is None:
        raise AppError("engine_unavailable", 503)
    try:
        engine.start(model.id, model.file_path, repo.setting_flag(session, "safe_mode_cpu"))
    except Exception as exc:
        raise AppError("engine_failed", 500) from exc
    return engine_status(session, engine, generations)


def run_benchmark(
    session: Session,
    engine: LocalEngine | None,
    generations: Generations,
    model_id: str | None,
) -> BenchmarkOut:
    model = _pick_model(session, model_id)
    if engine is None:
        raise AppError("engine_unavailable", 503)
    if generations.busy():
        raise AppError("busy", 409)
    try:
        run = engine.benchmark(
            model.id, model.file_path, repo.setting_flag(session, "safe_mode_cpu")
        )
    except Exception as exc:
        raise AppError("engine_failed", 500) from exc
    row = Benchmark(
        model_id=model.id,
        engine_build="vulkan" if run.build == "vulkan" else "cpu",
        tokens_per_second=round(run.tokens_per_second, 2),
        time_to_first_token_ms=run.time_to_first_token_ms,
        run_at=utcnow(),
    )
    repo.add(session, row)
    return _benchmark_out(row)


def acknowledge_fallback(session: Session, engine: LocalEngine | None) -> None:
    """Hide the GPU-to-CPU fallback notice, now and after a restart."""
    if engine is not None:
        engine.acknowledge_fallback()
    repo.acknowledge_fallbacks(session, utcnow())


# ------------------------------------------------------------------ downloads
def _download_out(job: Job) -> DownloadState:
    return DownloadState(
        entry_id=job.entry_id,
        status=job.status,
        received_bytes=job.received_bytes,
        total_bytes=job.total_bytes,
        speed_bps=job.speed_bps,
        error=job.error,
        started_at=job.started_at,
    )


class Installer:
    """Called by the download worker once every byte has arrived. Runs in its own session."""

    def __init__(self, db: Database, settings: Settings, entry_id: str) -> None:
        self.db, self.settings, self.entry_id = db, settings, entry_id

    def __call__(self, part: Path) -> None:
        entry = _match(part, self.entry_id)  # size, then SHA-256, like an offline import
        with self.db.session() as session:
            if repo.get(session, entry.id) is not None:
                part.unlink(missing_ok=True)
                raise AppError("model_installed", 409)
            target = self.settings.models_dir / entry.file_name
            os.replace(part, target)
            _install(session, entry, target, "download")
            session.commit()


def _free_bytes(folder: Path) -> int:
    probe = folder
    while not probe.exists() and probe != probe.parent:
        probe = probe.parent
    return shutil.disk_usage(probe).free


def start_download(
    session: Session,
    settings: Settings,
    db: Database,
    mirror: ModelMirror | None,
    downloads: Downloads,
    entry_id: str,
) -> DownloadState:
    entry = catalogue.find(entry_id)
    if entry is None:
        raise not_found("catalogue_entry")
    if repo.get(session, entry.id) is not None:
        raise AppError("model_installed", 409)
    if mirror is None:
        # The mirror host in the network allowlist is a placeholder until B-06.
        raise AppError("mirror_unavailable", 503)
    part = settings.models_dir / (entry.file_name + DOWNLOAD_SUFFIX)
    have = part.stat().st_size if part.exists() else 0
    if _free_bytes(settings.models_dir) < entry.size_bytes - have:
        raise AppError("not_enough_disk", 507)
    _load(db, settings, downloads)
    job = Job(
        entry_id=entry.id,
        url=entry.mirror_url,
        part=part,
        total_bytes=entry.size_bytes,
        report=Reporter(db),
    )
    downloads.start(job, mirror, Installer(db, settings, entry.id))
    return _download_out(job)


class Reporter:
    """Saves a download's state in model_downloads, in its own session (the worker's thread).

    A finished download is removed: the installed model is its record from then on.
    """

    def __init__(self, db: Database) -> None:
        self.db = db

    def __call__(self, job: Job) -> None:
        with self.db.session() as session:
            if job.status == "done":
                repo.delete_download(session, job.entry_id)
            else:
                repo.save_download(
                    session,
                    job.entry_id,
                    {
                        "status": job.status,
                        "received_bytes": job.received_bytes,
                        "total_bytes": job.total_bytes,
                        "error": job.error,
                        "started_at": job.started_at,
                    },
                )
            session.commit()


def _load(db: Database, settings: Settings, downloads: Downloads) -> None:
    """Once per start: list the downloads saved before, as paused (nothing runs any more)."""
    if downloads.loaded:
        return
    with db.session() as session:
        for row in repo.downloads(session):
            entry = catalogue.find(row.entry_id)
            if entry is None or downloads.get(row.entry_id) is not None:
                continue
            part = settings.models_dir / (entry.file_name + DOWNLOAD_SUFFIX)
            downloads.adopt(
                Job(
                    entry_id=entry.id,
                    url=entry.mirror_url,
                    part=part,
                    total_bytes=entry.size_bytes,
                    status="failed" if row.status == "failed" else "paused",
                    received_bytes=part.stat().st_size if part.exists() else 0,
                    error=row.error,
                    started_at=row.started_at,
                    report=Reporter(db),
                )
            )
    downloads.loaded = True


def list_downloads(db: Database, settings: Settings, downloads: Downloads) -> list[DownloadState]:
    _load(db, settings, downloads)
    return [_download_out(job) for job in downloads.all()]


def _job(db: Database, settings: Settings, downloads: Downloads, entry_id: str) -> Job:
    _load(db, settings, downloads)
    job = downloads.get(entry_id)
    if job is None:
        raise not_found("download")
    return job


def get_download(
    db: Database, settings: Settings, downloads: Downloads, entry_id: str
) -> DownloadState:
    return _download_out(_job(db, settings, downloads, entry_id))


def pause_download(
    db: Database, settings: Settings, downloads: Downloads, entry_id: str
) -> DownloadState:
    return _download_out(downloads.pause(_job(db, settings, downloads, entry_id)))


def resume_download(
    settings: Settings,
    db: Database,
    mirror: ModelMirror | None,
    downloads: Downloads,
    entry_id: str,
) -> DownloadState:
    """Continue where it stopped; also "Retry" after a failure."""
    job = _job(db, settings, downloads, entry_id)
    if mirror is None:
        raise AppError("mirror_unavailable", 503)
    if job.status == "done":
        raise AppError("model_installed", 409)
    downloads.resume(job, mirror, Installer(db, settings, entry_id))
    return _download_out(job)


def cancel_download(db: Database, settings: Settings, downloads: Downloads, entry_id: str) -> None:
    downloads.cancel(_job(db, settings, downloads, entry_id))
    with db.session() as session:
        repo.delete_download(session, entry_id)
        session.commit()


# ------------------------------------------------------------------ catalogue check
def check_catalogue(session: Session, mirror: ModelMirror | None) -> CatalogueCheckOut:
    """Ask the mirror which catalogue it offers and record the check (Settings > General).

    The bundled catalogue stays in use: replacing it needs the catalogue signing key (I-01).
    """
    if not repo.setting_flag(session, "catalogue_check"):
        raise AppError("catalogue_check_off", 409)
    if mirror is None:
        raise AppError("mirror_unavailable", 503)
    try:
        offered = mirror.catalogue_version()
    except Exception as exc:
        raise AppError("catalogue_unreachable", 503) from exc
    if not offered or len(offered) > 32:
        raise AppError("catalogue_signature_invalid", 422)
    previous = repo.last_catalogue_version(session) or catalogue.version()
    now = utcnow()
    repo.record_catalogue_check(session, offered, now)
    return CatalogueCheckOut(version=offered, changed=offered != previous, checked_at=now)
