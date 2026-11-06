"""setup and settings tables

Moves the three rows of the generic ``preferences`` table into typed tables owned by their
apps: ``settings`` (apps/settings), ``store_identity`` and ``setup_state`` (apps/setup). Existing
values are copied, then ``preferences`` is dropped. Downgrade copies them back.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-05
"""

import json
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op

from db.base import UTCDateTime, utcnow

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _stamps() -> tuple[sa.Column[Any], sa.Column[Any]]:
    return (
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
    )


def _settings_table() -> sa.TableClause:
    return sa.table(
        "settings",
        sa.column("id", sa.Integer),
        sa.column("update_check", sa.Boolean),
        sa.column("catalogue_check", sa.Boolean),
        sa.column("safe_mode_cpu", sa.Boolean),
        sa.column("default_model_id", sa.String),
        sa.column("created_at", UTCDateTime),
        sa.column("updated_at", UTCDateTime),
    )


def _store_table() -> sa.TableClause:
    return sa.table(
        "store_identity",
        sa.column("id", sa.Integer),
        sa.column("stream_id", sa.String),
        sa.column("signing_key_id", sa.String),
        sa.column("package_id", sa.String),
        sa.column("created_at", UTCDateTime),
        sa.column("updated_at", UTCDateTime),
    )


def _state_table() -> sa.TableClause:
    return sa.table(
        "setup_state",
        sa.column("id", sa.Integer),
        sa.column("first_run_complete", sa.Boolean),
        sa.column("completed_at", UTCDateTime),
        sa.column("restore_count", sa.Integer),
        sa.column("created_at", UTCDateTime),
        sa.column("updated_at", UTCDateTime),
    )


def _preferences_table() -> sa.TableClause:
    return sa.table(
        "preferences",
        sa.column("key", sa.String),
        sa.column("value", sa.Text),
        sa.column("created_at", UTCDateTime),
        sa.column("updated_at", UTCDateTime),
    )


def upgrade() -> None:
    op.create_table(
        "settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("update_check", sa.Boolean(), nullable=False),
        sa.Column("catalogue_check", sa.Boolean(), nullable=False),
        sa.Column("safe_mode_cpu", sa.Boolean(), nullable=False),
        sa.Column("default_model_id", sa.String(length=100), nullable=True),
        sa.Column("last_update_check", UTCDateTime(), nullable=True),
        sa.Column("update_available_version", sa.String(length=32), nullable=True),
        sa.Column("update_available_size", sa.BigInteger(), nullable=True),
        sa.Column("last_catalogue_check", UTCDateTime(), nullable=True),
        sa.Column("catalogue_version", sa.String(length=32), nullable=True),
        *_stamps(),
        sa.CheckConstraint("id = 1", name=op.f("ck_settings_single_row")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_settings")),
    )
    op.create_table(
        "setup_state",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("first_run_complete", sa.Boolean(), nullable=False),
        sa.Column("completed_at", UTCDateTime(), nullable=True),
        sa.Column("default_project_id", sa.String(length=36), nullable=True),
        sa.Column("last_restore_at", UTCDateTime(), nullable=True),
        sa.Column("restore_count", sa.Integer(), nullable=False),
        *_stamps(),
        sa.CheckConstraint("id = 1", name=op.f("ck_setup_state_single_row")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_setup_state")),
    )
    op.create_table(
        "store_identity",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("stream_id", sa.String(length=36), nullable=False),
        sa.Column("signing_key_id", sa.String(length=64), nullable=False),
        sa.Column("package_id", sa.String(length=36), nullable=False),
        *_stamps(),
        sa.CheckConstraint("id = 1", name=op.f("ck_store_identity_single_row")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_store_identity")),
    )

    conn = op.get_bind()
    old: dict[str, Any] = {
        key: json.loads(value)
        for key, value in conn.execute(sa.text("SELECT key, value FROM preferences"))
    }
    now = utcnow()
    stamps = {"created_at": now, "updated_at": now}
    settings = old.get("settings")
    if isinstance(settings, dict):
        conn.execute(
            _settings_table().insert(),
            {
                "id": 1,
                "update_check": bool(settings.get("update_check", True)),
                "catalogue_check": bool(settings.get("catalogue_check", True)),
                "safe_mode_cpu": bool(settings.get("safe_mode_cpu", False)),
                "default_model_id": settings.get("default_model_id"),
                **stamps,
            },
        )
    store = old.get("store")
    if isinstance(store, dict) and store.get("stream_id"):
        conn.execute(
            _store_table().insert(),
            {
                "id": 1,
                "stream_id": store["stream_id"],
                "signing_key_id": store.get("signing_key_id", ""),
                "package_id": store.get("package_id", ""),
                **stamps,
            },
        )
    if old.get("first_run_complete"):
        conn.execute(
            _state_table().insert(),
            {
                "id": 1,
                "first_run_complete": True,
                "completed_at": now,
                "restore_count": 0,
                **stamps,
            },
        )
    op.drop_table("preferences")


def downgrade() -> None:
    op.create_table(
        "preferences",
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        *_stamps(),
        sa.PrimaryKeyConstraint("key", name=op.f("pk_preferences")),
    )
    conn = op.get_bind()
    now = utcnow()
    rows: list[dict[str, Any]] = []

    def keep(key: str, value: Any) -> None:
        text = json.dumps(value, sort_keys=True, separators=(",", ":"))
        rows.append({"key": key, "value": text, "created_at": now, "updated_at": now})

    s = conn.execute(
        sa.text(
            "SELECT update_check, catalogue_check, safe_mode_cpu, default_model_id"
            " FROM settings WHERE id = 1"
        )
    ).first()
    if s is not None:
        keep(
            "settings",
            {
                "update_check": bool(s[0]),
                "catalogue_check": bool(s[1]),
                "safe_mode_cpu": bool(s[2]),
                "default_model_id": s[3],
            },
        )
    st = conn.execute(
        sa.text("SELECT stream_id, signing_key_id, package_id, created_at FROM store_identity")
    ).first()
    if st is not None:
        keep(
            "store",
            {
                "stream_id": st[0],
                "signing_key_id": st[1],
                "package_id": st[2],
                "created_at": str(st[3]),
            },
        )
    done = conn.execute(sa.text("SELECT first_run_complete FROM setup_state WHERE id = 1")).scalar()
    if done:
        keep("first_run_complete", True)
    if rows:
        conn.execute(_preferences_table().insert(), rows)
    op.drop_table("store_identity")
    op.drop_table("setup_state")
    op.drop_table("settings")
