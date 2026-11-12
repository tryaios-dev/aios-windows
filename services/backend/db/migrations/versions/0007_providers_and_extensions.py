"""providers table and extensions columns (E-05, MVP 9.1 and 9.5)

* ``providers``: where a conversation can run. ``local`` is created enabled; ``company`` exists
  only once an operator turns the flag on. No credential is stored here, only the name of the OS
  key store entry that holds it.
* ``extensions`` on projects, conversations, messages and summaries: a JSON object for fields an
  imported Project Package carries that this version does not understand, written back on export.

Plain ``ADD COLUMN`` / ``DROP COLUMN`` (no table rebuild), so the search triggers on
``messages`` stay in place both ways.

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from db.base import UTCDateTime

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CONTENT_TABLES = ("projects", "conversations", "messages", "summaries")


def upgrade() -> None:
    op.create_table(
        "providers",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("type", sa.String(length=16), nullable=False),
        sa.Column("base_url", sa.String(length=500), nullable=True),
        sa.Column("credential_ref", sa.String(length=100), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at", UTCDateTime(timezone=True), nullable=False),
        sa.Column("updated_at", UTCDateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_providers")),
    )
    op.execute(
        "INSERT INTO providers (id, type, base_url, credential_ref, enabled, created_at,"
        " updated_at) VALUES ('local', 'local', NULL, NULL, 1,"
        " strftime('%Y-%m-%d %H:%M:%f', 'now'), strftime('%Y-%m-%d %H:%M:%f', 'now'))"
    )
    for table in CONTENT_TABLES:
        op.add_column(
            table, sa.Column("extensions", sa.Text(), server_default="{}", nullable=False)
        )


def downgrade() -> None:
    for table in reversed(CONTENT_TABLES):
        # SQLite 3.35+ drops a column in place; a batch rebuild would lose the search triggers.
        op.execute(f"ALTER TABLE {table} DROP COLUMN extensions")
    op.drop_table("providers")
