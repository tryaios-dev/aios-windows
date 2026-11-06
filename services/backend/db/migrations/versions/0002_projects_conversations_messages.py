"""projects conversations messages evidence outbox

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-05
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from db.base import UTCDateTime

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "evidence_outbox",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("event_id", sa.String(length=36), nullable=False),
        sa.Column("type", sa.String(length=64), nullable=False),
        sa.Column("actor", sa.String(length=16), nullable=False),
        sa.Column("time", UTCDateTime(), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=True),
        sa.Column("conversation_id", sa.String(length=36), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=True),
        sa.Column("acknowledged_at", UTCDateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_evidence_outbox")),
        sa.UniqueConstraint("event_id", name=op.f("uq_evidence_outbox_event_id")),
    )
    with op.batch_alter_table("evidence_outbox", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_evidence_outbox_project_id"), ["project_id"], unique=False
        )
        batch_op.create_index(batch_op.f("ix_evidence_outbox_type"), ["type"], unique=False)

    op.create_table(
        "projects",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("classification", sa.String(length=16), nullable=False),
        sa.Column("classification_source", sa.String(length=16), nullable=False),
        sa.Column("derived_from_project_id", sa.String(length=36), nullable=True),
        sa.Column("imported_project_id", sa.String(length=36), nullable=True),
        sa.Column("imported_package_id", sa.String(length=36), nullable=True),
        sa.Column("company_ai_enabled", sa.Boolean(), nullable=False),
        sa.Column("archived", sa.Boolean(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_projects")),
    )
    op.create_table(
        "conversations",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("title", sa.String(length=500), nullable=False),
        sa.Column("classification_effective", sa.String(length=16), nullable=False),
        sa.Column("classification_source", sa.String(length=16), nullable=False),
        sa.Column("provider_mode", sa.String(length=16), nullable=False),
        sa.Column("current_provider", sa.String(length=16), nullable=False),
        sa.Column("model_id", sa.String(length=100), nullable=True),
        sa.Column("archived", sa.Boolean(), nullable=False),
        sa.Column("last_message_preview", sa.String(length=200), nullable=True),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("updated_at", UTCDateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["projects.id"],
            name=op.f("fk_conversations_project_id_projects"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_conversations")),
    )
    with op.batch_alter_table("conversations", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_conversations_project_id"), ["project_id"], unique=False
        )

    op.create_table(
        "messages",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("conversation_id", sa.String(length=36), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("classification_effective", sa.String(length=16), nullable=False),
        sa.Column("classification_source", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("provider", sa.String(length=16), nullable=False),
        sa.Column("model_id", sa.String(length=100), nullable=True),
        sa.Column("prompt_tokens", sa.Integer(), nullable=False),
        sa.Column("completion_tokens", sa.Integer(), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.Column("input_nonce", sa.String(length=43), nullable=True),
        sa.Column("output_nonce", sa.String(length=43), nullable=True),
        sa.Column("evidence_outbox_id", sa.Integer(), nullable=True),
        sa.Column("previous_versions", sa.Text(), nullable=True),
        sa.Column("continued_from", sa.String(length=36), nullable=True),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["conversations.id"],
            name=op.f("fk_messages_conversation_id_conversations"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_messages")),
    )
    with op.batch_alter_table("messages", schema=None) as batch_op:
        batch_op.create_index(
            "ix_messages_conversation_position", ["conversation_id", "position"], unique=False
        )

    op.create_table(
        "provider_moves",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("conversation_id", sa.String(length=36), nullable=False),
        sa.Column("to_provider", sa.String(length=16), nullable=False),
        sa.Column("at", UTCDateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["conversations.id"],
            name=op.f("fk_provider_moves_conversation_id_conversations"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_provider_moves")),
    )
    with op.batch_alter_table("provider_moves", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_provider_moves_conversation_id"), ["conversation_id"], unique=False
        )

    op.create_table(
        "summaries",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("conversation_id", sa.String(length=36), nullable=False),
        sa.Column("covers_until_message_id", sa.String(length=36), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("classification_effective", sa.String(length=16), nullable=False),
        sa.Column("classification_source", sa.String(length=16), nullable=False),
        sa.Column("model_id", sa.String(length=100), nullable=False),
        sa.Column("provider", sa.String(length=16), nullable=False),
        sa.Column("created_at", UTCDateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["conversations.id"],
            name=op.f("fk_summaries_conversation_id_conversations"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_summaries")),
    )
    with op.batch_alter_table("summaries", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_summaries_conversation_id"), ["conversation_id"], unique=False
        )


def downgrade() -> None:
    with op.batch_alter_table("summaries", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_summaries_conversation_id"))

    op.drop_table("summaries")
    with op.batch_alter_table("provider_moves", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_provider_moves_conversation_id"))

    op.drop_table("provider_moves")
    with op.batch_alter_table("messages", schema=None) as batch_op:
        batch_op.drop_index("ix_messages_conversation_position")

    op.drop_table("messages")
    with op.batch_alter_table("conversations", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_conversations_project_id"))

    op.drop_table("conversations")
    op.drop_table("projects")
    with op.batch_alter_table("evidence_outbox", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_evidence_outbox_type"))
        batch_op.drop_index(batch_op.f("ix_evidence_outbox_project_id"))

    op.drop_table("evidence_outbox")
