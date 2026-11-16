"""Recovery key issued at (Settings > Backup and recovery, decision D4).

One nullable column on setup_state: when the current recovery key was shown, at first run or when
a new key was created. Installations from before this version start with no time recorded.

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-15 07:20:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from db.base import UTCDateTime

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("setup_state", schema=None) as batch_op:
        batch_op.add_column(sa.Column("recovery_key_issued_at", UTCDateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("setup_state", schema=None) as batch_op:
        batch_op.drop_column("recovery_key_issued_at")
