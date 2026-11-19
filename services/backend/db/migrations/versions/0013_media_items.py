"""Pictures and videos (R-7).

One new table: each picture or video made on the company server for a project, what was asked,
how the job went, and the finished file (chats.db is SQLCipher, so the file is encrypted).
Deleting a project deletes its pictures and videos.

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-19 23:30:38.525262
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from db.base import UTCDateTime

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "media_items",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("model", sa.String(length=64), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("negative_prompt", sa.Text(), nullable=True),
        sa.Column("width", sa.Integer(), nullable=False),
        sa.Column("height", sa.Integer(), nullable=False),
        sa.Column("frames", sa.Integer(), nullable=True),
        sa.Column("seed", sa.BigInteger(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("progress", sa.Float(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=True),
        sa.Column("remote_job_id", sa.String(length=80), nullable=True),
        sa.Column("error_code", sa.String(length=48), nullable=True),
        sa.Column("mime", sa.String(length=32), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("data", sa.LargeBinary(), nullable=True),
        sa.Column("finished_at", UTCDateTime(), nullable=True),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_media_items_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_media_items")),
    )
    with op.batch_alter_table("media_items") as batch:
        batch.create_index(batch.f("ix_media_items_project_id"), ["project_id"], unique=False)


def downgrade() -> None:
    with op.batch_alter_table("media_items") as batch:
        batch.drop_index(batch.f("ix_media_items_project_id"))
    op.drop_table("media_items")
