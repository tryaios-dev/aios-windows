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


class Restored(BaseModel):
    stream_id: str
    epoch: int | None = None  # the evidence epoch the restore started
