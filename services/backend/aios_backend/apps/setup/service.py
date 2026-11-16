"""First-run rules: create the store (signing key, recovery key, recovery.pkg), finish setup,
make a backup, and restore a backup with its recovery key (M-15, AC-17; Recovery Package v1,
section 5; backup: decision D3).

Security-relevant. Keys go only to the OS keystore (desktop profile) and into the wrapped
Recovery Package; the recovery key is returned once and kept nowhere. Nothing here logs.
"""

import os
import secrets
import shutil
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from aios_backend.apps.setup import recovery_package as rp
from aios_backend.apps.setup import repository as repo
from aios_backend.apps.setup.schemas import (
    BackupOut,
    Completed,
    RecoveryKeyOut,
    Restored,
    SetupStatus,
    StoreCreated,
)
from aios_backend.config import APP_VERSION, Settings
from aios_backend.errors import AppError
from aios_backend.evidence.client import WriterClient, WriterUnavailable
from aios_common import keystore
from aios_common.canonical import b64url
from db import lookups, migrate
from db.base import utcnow
from db.models import Project
from db.session import KEYSTORE_ENTRY as DB_KEY_ENTRY
from db.session import Database
from db.sqlcipher import backup_encrypted, integrity_ok

SIGNING_ENTRY = "evidence-signing-seed"
DEFAULT_PROJECT = "My workspace"


def _write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def _signing_seed(settings: Settings) -> bytes:
    """The evidence signing seed: fixed in dev/test, else from the keystore (created once)."""
    if settings.signing_seed is not None:
        return bytes.fromhex(settings.signing_seed)
    existing = keystore.get_secret(SIGNING_ENTRY)
    if existing:
        return bytes.fromhex(existing)
    seed = secrets.token_bytes(32)
    keystore.set_secret(SIGNING_ENTRY, seed.hex())
    return seed


def _security_state(session: Session, db: Database) -> dict[str, Any]:
    """MVP 9.4 ``security_state_revision`` in Phase 1a: migration and catalogue versions."""
    return {"migration": migrate.current(db), "catalogue": lookups.catalogue_version(session)}


def _writer_file(writer: WriterClient | None) -> str | None:
    """The evidence writer's file name, for the backup manifest; None without a writer."""
    if writer is None:
        return None
    try:
        name = writer.status().get("file_name")
    except WriterUnavailable:
        return None
    return name if isinstance(name, str) else None


def current_signing_seed(settings: Settings) -> bytes:
    """The seed the writer signs with now. After a restore the writer has rotated it."""
    if settings.signing_seed is not None:
        return bytes.fromhex(settings.signing_seed)
    value = keystore.get_secret(SIGNING_ENTRY)
    if not value:
        raise AppError("signing_key_missing", 503)
    return bytes.fromhex(value)


def status(session: Session, settings: Settings) -> SetupStatus:
    identity = repo.store(session)
    state = repo.state(session)
    return SetupStatus(
        first_run_complete=state.first_run_complete,
        store_created=identity is not None,
        stream_id=identity.stream_id if identity else None,
        signing_key_id=identity.signing_key_id if identity else None,
        package_id=identity.package_id if identity else None,
        default_project_id=state.default_project_id,
        completed_at=state.completed_at,
        last_restore_at=state.last_restore_at,
        recovery_package_present=settings.recovery_pkg.is_file(),
        backup_location=state.backup_location,
        last_backup_at=state.last_backup_at,
        last_backup_size=state.last_backup_size,
        recovery_key_issued_at=state.recovery_key_issued_at,
    )


def create_store(
    session: Session, db: Database, settings: Settings, writer: WriterClient | None = None
) -> StoreCreated:
    if repo.store(session) is not None:
        raise AppError("store_exists", 409)

    seed = _signing_seed(settings)
    public = rp.public_key(seed)
    signing_key_id = rp.key_id(public)
    stream_id = str(uuid.uuid4())
    recovery_key = rp.new_recovery_key()
    file_bytes, package_id = rp.write(
        recovery_key=recovery_key,
        db_key=bytes.fromhex(db.key_hex()),
        signing_seed=seed,
        stream_id=stream_id,
        security_state_revision=_security_state(session, db),
        writer_file=_writer_file(writer),
    )
    _write_atomic(settings.recovery_pkg, file_bytes)

    repo.save_store(
        session, stream_id=stream_id, signing_key_id=signing_key_id, package_id=package_id
    )
    # Genesis first (Evidence Wire Format v1, section 4), then the package and the key.
    repo.record_event(
        session,
        "store_created",
        actor="app",
        body={"signing_key": b64url(public), "key_id": signing_key_id, "app_version": APP_VERSION},
    )
    repo.record_event(
        session,
        "recovery_package_written",
        actor="app",
        body={"package_id": package_id, "package_digest": rp.package_digest(file_bytes)},
    )
    repo.record_event(session, "recovery_key_issued", actor="app", body={"package_id": package_id})
    repo.mark_key_issued(session)
    return StoreCreated(
        recovery_key=rp.format_recovery_key(recovery_key),
        package_id=package_id,
        stream_id=stream_id,
        signing_key_id=signing_key_id,
    )


def complete(session: Session) -> Completed:
    """Finish first run: mark it done and create the default Restricted project once."""
    if repo.store(session) is None:
        raise AppError("store_not_created", 409)
    project = repo.first_project(session)
    if project is None:
        project = Project(
            id=str(uuid.uuid4()),
            name=DEFAULT_PROJECT,
            classification="restricted",
            classification_source="project",
            company_ai_enabled=False,
            archived=False,
        )
        repo.add(session, project)
        repo.record_event(
            session,
            "project_created",
            actor="app",
            project_id=project.id,
            body={"project_id": project.id, "classification": "restricted", "default": True},
        )
    repo.set_first_run_complete(session, project.id)
    return Completed(default_project_id=project.id)


# ------------------------------------------------------------------ new recovery key (D4)
def _evidence_tip(writer: WriterClient | None) -> dict[str, Any] | None:
    """The writer's tip, recorded in the package so a restore checks the evidence reaches it."""
    if writer is None:
        return None
    try:
        st = writer.status()
    except WriterUnavailable:
        return None
    if st.get("tip_seq") is None:
        return None
    return {
        "stream_id": st["stream_id"],
        "epoch": st["epoch"],
        "seq": st["tip_seq"],
        "event_hash": st["tip_hash"],
    }


def new_recovery_key(
    session: Session, db: Database, settings: Settings, writer: WriterClient | None = None
) -> RecoveryKeyOut:
    """Wrap the same database key and signing key under a new recovery key (decision D4).

    recovery.pkg is written again, so the new key opens backups made from now on; backups made
    before still open only with the older key (their own package wraps it). The new key is
    returned once and kept nowhere; the events record only the package id (SR-07).
    """
    identity = repo.store(session)
    if identity is None:
        raise AppError("store_not_created", 409)
    recovery_key = rp.new_recovery_key()
    file_bytes, package_id = rp.write(
        recovery_key=recovery_key,
        db_key=bytes.fromhex(db.key_hex()),
        signing_seed=current_signing_seed(settings),
        stream_id=identity.stream_id,
        security_state_revision=_security_state(session, db),
        evidence_tip=_evidence_tip(writer),
        writer_file=_writer_file(writer),
    )
    _write_atomic(settings.recovery_pkg, file_bytes)
    repo.update_store(session, signing_key_id=identity.signing_key_id, package_id=package_id)
    repo.record_event(
        session,
        "recovery_package_written",
        actor="app",
        body={"package_id": package_id, "package_digest": rp.package_digest(file_bytes)},
    )
    repo.record_event(session, "recovery_key_issued", actor="user", body={"package_id": package_id})
    repo.mark_key_issued(session)
    return RecoveryKeyOut(
        recovery_key=rp.format_recovery_key(recovery_key),
        package_id=package_id,
        issued_at=repo.state(session).recovery_key_issued_at or utcnow(),
    )


# ------------------------------------------------------------------ backup (decision D3)
def set_backup_location(session: Session, settings: Settings, path_text: str | None) -> SetupStatus:
    """Where backups go: an existing folder, chosen in the system folder dialog. ``None`` clears it."""
    if path_text is not None:
        folder = Path(path_text)
        if not folder.is_absolute() or not folder.is_dir():
            raise AppError("invalid_path", 400)
    repo.set_backup_location(session, path_text)
    return status(session, settings)


def _new_backup_folder(location: Path) -> Path:
    """``AIOS backup 2026-11-15 0648``; a second backup in the same minute gets a number."""
    base = f"AIOS backup {utcnow():%Y-%m-%d %H%M}"
    folder, n = location / base, 1
    while folder.exists() or folder.with_name(folder.name + ".partial").exists():
        n += 1
        folder = location / f"{base} ({n})"
    return folder


def backup(
    session: Session, db: Database, settings: Settings, writer: WriterClient | None = None
) -> BackupOut:
    """A backup restore accepts as it is, written to a new folder in the chosen location.

    chats.db is copied through SQLite's online backup (a consistent snapshot while AIOS runs) and
    must pass the integrity check; the evidence file is copied by the evidence writer, the only
    process that opens it (SR-04); recovery.pkg is copied as it is, so the same recovery key opens
    the backup. Every file the package's manifest requires must be there. The folder appears only
    when it is complete; on any failure nothing is left behind and nothing is recorded.
    """
    if repo.store(session) is None:
        raise AppError("store_not_created", 409)
    state = repo.state(session)
    if not state.backup_location:
        raise AppError("no_backup_location", 409)
    location = Path(state.backup_location)
    if not location.is_dir():
        raise AppError("backup_location_unavailable", 422)  # the drive is not plugged in
    if not settings.recovery_pkg.is_file():
        raise AppError("no_recovery_package", 409)

    folder = _new_backup_folder(location)
    partial = folder.with_name(folder.name + ".partial")
    try:
        partial.mkdir(parents=True)
        key = db.key_hex()
        backup_encrypted(settings.chats_db, partial / "chats.db", key)
        if not integrity_ok(partial / "chats.db", key):
            raise AppError("backup_unreadable", 500)
        pkg_bytes = settings.recovery_pkg.read_bytes()
        shutil.copyfile(settings.recovery_pkg, partial / "recovery.pkg")
        if writer is not None:
            # The writer names its own file (AC-14: the backend never names it); without the
            # name the evidence cannot be copied, so the backup stops instead of guessing.
            writer_file = _writer_file(writer)
            if writer_file is None:
                raise AppError("writer_unavailable", 503)
            writer.backup(str(partial / writer_file))
        missing = [n for n in rp.required_files(rp.read(pkg_bytes)) if not (partial / n).is_file()]
        if missing:
            raise AppError("backup_incomplete", 500)
        os.replace(partial, folder)
    except AppError:
        shutil.rmtree(partial, ignore_errors=True)
        raise
    except WriterUnavailable as exc:
        shutil.rmtree(partial, ignore_errors=True)
        raise AppError("writer_unavailable", 503) from exc
    except OSError as exc:
        shutil.rmtree(partial, ignore_errors=True)
        raise AppError("backup_failed", 500) from exc

    files = [p for p in folder.iterdir() if p.is_file()]
    size = sum(p.stat().st_size for p in files)
    repo.mark_backed_up(session, size)
    # Content-free (SR-07): no folder or file names. Not in the v1 registry yet: the wire-format
    # owner has to agree the type (decision 19); verifiers report it as unknown_type.
    repo.record_event(
        session, "backup_created", actor="user", body={"size_bytes": size, "files": len(files)}
    )
    return BackupOut(
        path=str(folder),
        size_bytes=size,
        files=len(files),
        conversations=repo.conversation_count(session),
        at=repo.state(session).last_backup_at or utcnow(),
    )


# ------------------------------------------------------------------ restore
def _unwrap(folder: Path, recovery_key_text: str) -> tuple[rp.Payload, bytes, dict[str, Any]]:
    pkg_file, db_file = folder / "recovery.pkg", folder / "chats.db"
    if not folder.is_absolute() or not folder.is_dir():
        raise AppError("invalid_path", 400)
    if not pkg_file.is_file():
        raise AppError("no_recovery_package", 422)
    if not db_file.is_file():
        raise AppError("no_backup_database", 422)
    file_bytes = pkg_file.read_bytes()
    try:
        pkg = rp.read(file_bytes)  # R_FORMAT / R_KDF_PARAMS before any KDF runs
        key = rp.parse_recovery_key(recovery_key_text)  # R_CHECKSUM before any KDF runs
        payload = rp.unwrap(pkg, key)  # R_UNWRAP / R_PAYLOAD
    except rp.RecoveryError as exc:
        raise AppError(exc.code.lower(), 422) from exc
    for name in rp.required_files(pkg):  # the backup manifest (MVP 9.4, question 10)
        if not (folder / name).is_file():
            raise AppError("r_missing_file", 422)
    return payload, file_bytes, pkg


def _in_use(db: Database) -> bool:
    """Whether this installation holds a finished setup. A locked store counts as not in use:
    restoring is exactly how a store without its key is opened again."""
    try:
        with db.session() as session:
            return repo.first_run_done(session)
    except Exception:
        return False


_WRITER_REFUSALS = {
    "chain_invalid": "r_evidence_invalid",
    "chain_short": "r_evidence_short",
    "stream_mismatch": "r_mismatch",
    "signing_key_mismatch": "r_mismatch",
    "no_backup_evidence": "r_missing_file",
}


def restore(
    db: Database,
    settings: Settings,
    backup_path: str,
    recovery_key_text: str,
    confirmed: bool = False,
    writer: WriterClient | None = None,
    signing_seed: Callable[[], bytes] | None = None,
) -> Restored:
    """Restore a backup on this device (M-15, M-16, AC-17), all or nothing.

    1. The package unwraps with the recovery key; the backup holds every file its manifest
       requires; chats.db opens with the unwrapped key, passes SQLite's integrity check and
       belongs to the package's stream.
    2. chats.db and the keys are put in place, and migrations run.
    3. The evidence writer verifies the backup's evidence file (every hash, link and signature, up
       to at least the tip the package recorded), then continues it under a new epoch with a new
       signing key; the recovered key signs the handover checkpoint.
    4. recovery.pkg is written again for the new key, under the same recovery key.

    Any failure in 1 to 3 puts chats.db and the keys back as they were. Replacing a finished
    installation needs ``confirmed`` (the "Restore over" dialog). Without a writer (tests,
    development) step 3 is skipped and the continuation stays pending.
    """
    if not confirmed and _in_use(db):
        raise AppError("confirmation_required", 400)
    folder = Path(backup_path)
    if (folder / "chats.db").resolve() == settings.chats_db.resolve():
        raise AppError("invalid_path", 400)  # that is the live data folder, not a backup
    payload, pkg_bytes, pkg = _unwrap(folder, recovery_key_text)
    db_hex = payload.db_key.hex()
    if settings.db_key is not None and db_hex != settings.db_key:
        raise AppError("r_mismatch", 422)  # dev/test stores use their fixed key
    try:
        backup_stream = repo.backup_stream_id(folder / "chats.db", db_hex)
    except Exception as exc:
        raise AppError("r_mismatch", 422) from exc  # the key does not open this backup
    if backup_stream != payload.stream_id:
        raise AppError("r_mismatch", 422)  # "This recovery key belongs to a different store"
    if not repo.backup_is_sound(folder / "chats.db", db_hex):
        raise AppError("r_damaged", 422)

    target = settings.chats_db
    before = target.with_name(target.name + ".before-restore")
    previous_keys: dict[str, str | None] = {}
    if settings.db_key is None:
        previous_keys = {n: keystore.get_secret(n) for n in (DB_KEY_ENTRY, SIGNING_ENTRY)}
    migrate.backup(db)
    db.dispose()
    if target.exists():
        os.replace(target, before)
    evidence: dict[str, Any] | None = None
    try:
        _write_atomic(target, (folder / "chats.db").read_bytes())
        if settings.db_key is None:
            keystore.set_secret(DB_KEY_ENTRY, db_hex)
            keystore.set_secret(SIGNING_ENTRY, payload.signing_seed.hex())
        migrate.upgrade(db)  # the backup may be from an older version
        if writer is not None:
            tip = pkg.get("evidence_tip")
            evidence = writer.restore(str(folder), payload.stream_id, tip["seq"] if tip else None)
        with db.session() as session:
            repo.mark_restored(session)
            if evidence is not None:
                epoch, key = int(evidence["epoch"]), str(evidence["key_id"])
            else:
                epoch = 1 + repo.state(session).restore_count
                key = rp.key_id(rp.public_key(payload.signing_seed))
            # A mirror of the writer's own continuation event (the pump matches it up).
            repo.record_event(
                session,
                "continuation",
                actor="app",
                body={"reason": "restore", "key_id": key, "epoch": epoch},
            )
            session.commit()
    except WriterUnavailable as exc:
        _undo_restore(db, target, before, previous_keys)
        refused = _WRITER_REFUSALS.get(exc.code)
        raise AppError(refused or "restore_failed", 422 if refused else 503) from exc
    except Exception as exc:
        _undo_restore(db, target, before, previous_keys)
        raise AppError("restore_failed", 500) from exc
    before.unlink(missing_ok=True)

    if evidence is None:
        _write_atomic(settings.recovery_pkg, pkg_bytes)
        return Restored(stream_id=payload.stream_id, epoch=epoch)
    # The writer rotated the signing key: wrap the new one under the same recovery key.
    new_seed = signing_seed() if signing_seed is not None else current_signing_seed(settings)
    with db.session() as session:
        file_bytes, package_id = rp.write(
            recovery_key=rp.parse_recovery_key(recovery_key_text),
            db_key=payload.db_key,
            signing_seed=new_seed,
            stream_id=payload.stream_id,
            security_state_revision=_security_state(session, db),
            writer_file=_writer_file(writer),
            evidence_tip={
                "stream_id": payload.stream_id,
                "epoch": evidence["epoch"],
                "seq": evidence["seq"],
                "event_hash": evidence["event_hash"],
            },
        )
        _write_atomic(settings.recovery_pkg, file_bytes)
        repo.update_store(session, signing_key_id=evidence["key_id"], package_id=package_id)
        repo.record_event(
            session,
            "recovery_package_written",
            actor="app",
            body={"package_id": package_id, "package_digest": rp.package_digest(file_bytes)},
        )
        session.commit()
    return Restored(stream_id=payload.stream_id, epoch=epoch)


def _undo_restore(
    db: Database, target: Path, before: Path, previous_keys: dict[str, str | None]
) -> None:
    """Put chats.db and the keys back exactly as they were: no partial state (AC-17)."""
    db.dispose()
    if before.exists():
        os.replace(before, target)
    else:
        target.unlink(missing_ok=True)
    for name, value in previous_keys.items():
        if value is not None:
            keystore.set_secret(name, value)
            continue
        try:
            keystore.delete_secret(name)
        except Exception:  # noqa: S110 - nothing was there to remove
            pass
