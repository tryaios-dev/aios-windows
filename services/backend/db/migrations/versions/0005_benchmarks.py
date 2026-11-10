"""benchmarks

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-06
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from db.base import UTCDateTime

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "benchmarks",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("model_id", sa.String(length=64), nullable=False),
        sa.Column("engine_build", sa.String(length=16), nullable=False),
        sa.Column("tokens_per_second", sa.Float(), nullable=False),
        sa.Column("time_to_first_token_ms", sa.Integer(), nullable=False),
        sa.Column("run_at", UTCDateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_benchmarks")),
    )


def downgrade() -> None:
    op.drop_table("benchmarks")
