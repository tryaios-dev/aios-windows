"""linked resources

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-20 00:04:14.185345
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
        "linked_resources",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("monthly_limit", sa.Float(), nullable=True),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_linked_resources")),
    )


def downgrade() -> None:
    op.drop_table("linked_resources")
