"""Backup location and last backup (Settings > Backup and recovery, decision D3).

Three nullable columns on setup_state: the folder the person chose, and when the last backup was
made and how large it was. Existing installations start with no backup recorded.

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-15 06:48:42.506264
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from db.base import UTCDateTime

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("setup_state", schema=None) as batch_op:
        batch_op.add_column(sa.Column("backup_location", sa.String(length=1024), nullable=True))
        batch_op.add_column(sa.Column("last_backup_at", UTCDateTime(), nullable=True))
        batch_op.add_column(sa.Column("last_backup_size", sa.BigInteger(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("setup_state", schema=None) as batch_op:
        batch_op.drop_column("last_backup_size")
        batch_op.drop_column("last_backup_at")
        batch_op.drop_column("backup_location")
