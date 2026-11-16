"""Skills added to the AI (Add skills to my AI).

Revision ID: 0011
Revises: 0010
Create Date: 2026-11-16 12:10:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from db.base import UTCDateTime

revision: str = "0011"
down_revision: str | None = "0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "skills",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("line", sa.String(length=300), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False),
        sa.Column("category", sa.String(length=32), nullable=False),
        sa.Column("publisher", sa.String(length=120), nullable=False),
        sa.Column("licence", sa.String(length=64), nullable=False),
        sa.Column("open_source", sa.Boolean(), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("version", sa.String(length=32), nullable=False),
        sa.Column("uses", sa.Text(), nullable=False),
        sa.Column("example", sa.String(length=500), nullable=False),
        sa.Column("instruction", sa.Text(), nullable=False),
        sa.Column("own", sa.Boolean(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_skills")),
    )


def downgrade() -> None:
    op.drop_table("skills")
