"""Voice: the languages the person speaks (Settings > Voice).

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-18 18:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("settings") as batch:
        batch.add_column(sa.Column("voice_languages", sa.String(length=32), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("settings") as batch:
        batch.drop_column("voice_languages")
