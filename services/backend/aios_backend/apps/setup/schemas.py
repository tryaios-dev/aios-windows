"""Request and response bodies for first-run setup and restore.

Hardware check, model download and benchmark belong to the local model module and are not
here yet.
"""

from datetime import datetime

from pydantic import BaseModel, Field


class SetupStatus(BaseModel):
    """Where first run stands. The UI opens setup until ``first_run_complete`` is true."""

    first_run_complete: bool
    store_created: bool
    stream_id: str | None
    signing_key_id: str | None
    package_id: str | None
    default_project_id: str | None
    completed_at: datetime | None
    last_restore_at: datetime | None
    recovery_package_present: bool
    # Backup (decision D3). Optional fields: older clients ignore them.
    backup_location: str | None = None
    last_backup_at: datetime | None = None
    last_backup_size: int | None = None
    # When the current recovery key was shown (first run, or a new key: decision D4).
    recovery_key_issued_at: datetime | None = None


class StoreCreated(BaseModel):
    """``recovery_key`` is in this response exactly once and stored nowhere by AIOS."""

    recovery_key: str
    package_id: str
    stream_id: str
    signing_key_id: str


class Completed(BaseModel):
    default_project_id: str


class RestoreIn(BaseModel):
    """``backup_path``: the backed-up data folder holding ``chats.db`` and ``recovery.pkg``."""

    backup_path: str = Field(min_length=1, max_length=1024)
    recovery_key: str = Field(min_length=1, max_length=100)
    # Must be true when a finished installation would be replaced (the confirm dialog).
    confirmed: bool = False


class BackupLocationIn(BaseModel):
    """The folder backups go to, chosen in the system folder dialog. ``null``: set up later."""

    path: str | None = Field(default=None, min_length=1, max_length=1024)


class BackupOut(BaseModel):
    """One backup: a new folder inside the chosen location that restore accepts as it is."""

    path: str
    size_bytes: int
    files: int
    conversations: int
    at: datetime


class RecoveryKeyOut(BaseModel):
    """A new recovery key for this installation. ``recovery_key`` is in this reply exactly once."""

    recovery_key: str
    package_id: str
    issued_at: datetime


class Restored(BaseModel):
    stream_id: str
    epoch: int | None = None  # the evidence epoch the restore started
