"""First-run rules: create the store (signing key, recovery key, recovery.pkg), finish setup,
and restore a backup with its recovery key (M-15, AC-17; Recovery Package v1, section 5).

Security-relevant. Keys go only to the OS keystore (desktop profile) and into the wrapped
Recovery Package; the recovery key is returned once and kept nowhere. Nothing here logs.
"""

import os
import secrets
import uuid
from pathlib import Path

from sqlalchemy.orm import Session

from aios_backend.apps.setup import recovery_package as rp
from aios_backend.apps.setup import repository as repo
from aios_backend.apps.setup.schemas import Completed, Restored, SetupStatus, StoreCreated
from aios_backend.config import APP_VERSION, Settings
from aios_backend.errors import AppError
from aios_common import keystore
from aios_common.canonical import b64url
from db import migrate
from db.models import Project
from db.session import KEYSTORE_ENTRY as DB_KEY_ENTRY
from db.session import Database

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
    )


def create_store(session: Session, db: Database, settings: Settings) -> StoreCreated:
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


# ------------------------------------------------------------------ restore
def _unwrap(folder: Path, recovery_key_text: str) -> tuple[rp.Payload, bytes]:
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
    return payload, file_bytes


def restore(db: Database, settings: Settings, backup_path: str, recovery_key_text: str) -> Restored:
    folder = Path(backup_path)
    if (folder / "chats.db").resolve() == settings.chats_db.resolve():
        raise AppError("invalid_path", 400)  # that is the live data folder, not a backup
    payload, pkg_bytes = _unwrap(folder, recovery_key_text)
    db_hex = payload.db_key.hex()
    if settings.db_key is not None and db_hex != settings.db_key:
        raise AppError("r_mismatch", 422)  # dev/test stores use their fixed key
    try:
        backup_stream = repo.backup_stream_id(folder / "chats.db", db_hex)
    except Exception as exc:
        raise AppError("r_mismatch", 422) from exc  # the key does not open this backup
    if backup_stream != payload.stream_id:
        raise AppError("r_mismatch", 422)  # "This recovery key belongs to a different store"

    target = settings.chats_db
    before = target.with_name(target.name + ".before-restore")
    previous_keys = {}
    if settings.db_key is None:
        previous_keys = {n: keystore.get_secret(n) for n in (DB_KEY_ENTRY, SIGNING_ENTRY)}
    migrate.backup(db)
    db.dispose()
    if target.exists():
        os.replace(target, before)
    try:
        _write_atomic(target, (folder / "chats.db").read_bytes())
        if settings.db_key is None:
            keystore.set_secret(DB_KEY_ENTRY, db_hex)
            keystore.set_secret(SIGNING_ENTRY, payload.signing_seed.hex())
        migrate.upgrade(db)  # the backup may be from an older version
        with db.session() as session:
            repo.mark_restored(session)
            repo.record_event(
                session,
                "continuation",
                actor="app",
                body={
                    "reason": "restore",
                    "key_id": rp.key_id(rp.public_key(payload.signing_seed)),
                },
            )
            session.commit()
    except Exception as exc:
        # Put everything back as it was: no partial state is left behind.
        db.dispose()
        if before.exists():
            os.replace(before, target)
        for name, value in previous_keys.items():
            if value is not None:
                keystore.set_secret(name, value)
        raise AppError("restore_failed", 500) from exc
    before.unlink(missing_ok=True)
    _write_atomic(settings.recovery_pkg, pkg_bytes)
    return Restored(stream_id=payload.stream_id)
