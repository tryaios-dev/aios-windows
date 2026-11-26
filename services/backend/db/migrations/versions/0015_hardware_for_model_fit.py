"""hardware for model fit

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-25 12:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("hardware_profile", schema=None) as batch_op:
        batch_op.add_column(sa.Column("usable_ram_bytes", sa.BigInteger(), nullable=True))
        batch_op.add_column(sa.Column("memory_label", sa.String(length=32), nullable=True))
        batch_op.add_column(sa.Column("memory_bandwidth_gbs", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("gpu_bandwidth_gbs", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("card_free_bytes", sa.BigInteger(), nullable=True))
        batch_op.add_column(sa.Column("card_integrated", sa.Boolean(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("hardware_profile", schema=None) as batch_op:
        batch_op.drop_column("card_integrated")
        batch_op.drop_column("card_free_bytes")
        batch_op.drop_column("gpu_bandwidth_gbs")
        batch_op.drop_column("memory_bandwidth_gbs")
        batch_op.drop_column("memory_label")
        batch_op.drop_column("usable_ram_bytes")
