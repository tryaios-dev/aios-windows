"""Knowledge documents (My secure knowledge).

One new table: each document's encrypted copy (chats.db is SQLCipher), its kind, size and the
text AIOS read from it, or the reason it could not be read.

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-16 11:33:07.879677
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from db.base import UTCDateTime

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "knowledge_docs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=260), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("pages", sa.Integer(), nullable=True),
        sa.Column("collection", sa.String(length=260), nullable=False),
        sa.Column("origin", sa.String(length=1024), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("problem", sa.String(length=300), nullable=True),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_knowledge_docs")),
    )


def downgrade() -> None:
    op.drop_table("knowledge_docs")
