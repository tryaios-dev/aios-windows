"""Chat rules: conversations, provider moves (M-09), sending and regenerating, commitments.

Answers come from an ``AnswerSource`` (see answers.py); chat only decides whether a message
may be sent, stores both sides, and queues the content-free ``inference_completed`` event with
hiding commitments (Evidence Wire Format v1, section 8). The commitment nonces stay in chats.db.
"""

import json
import math
import re
import secrets
import uuid
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from aios_backend.apps.chat import repository as repo
from aios_backend.apps.chat.answers import AnswerSource, ModelInfo
from aios_backend.apps.chat.schemas import (
    ConversationOut,
    Exchange,
    MessageOut,
    ProviderMoveOut,
    ProvidersStatus,
)
from aios_backend.config import Settings
from aios_backend.errors import AppError, not_found
from aios_common.canonical import b64url, jcs, tagged_hash
from db.models import Conversation, Message, ProviderMove

MAX_ANSWER_TOKENS = 1500
SYSTEM_PROMPT_TOKENS = 220
NEW_TITLE = "New conversation"
INPUT_TAG = "aios/evidence/v1/commit/input"
OUTPUT_TAG = "aios/evidence/v1/commit/output"
EVIDENCE_STATUS = {
    "complete": "ok",
    "stopped": "cancelled",
    "partial": "cancelled",
    "error": "error",
}


# ------------------------------------------------------------------ text helpers (same as the UI)
def estimate_tokens(text: str) -> int:
    return math.ceil(len(text) / 3.5)


def truncate(text: str, limit: int) -> str:
    clean = re.sub(r"\s+", " ", text).strip()
    return clean if len(clean) <= limit else clean[: limit - 1].rstrip() + "…"


def preview(text: str) -> str:
    return truncate(re.sub(r"[#*`>|\-\[\]]", "", text), 140)


def context_budget(context_length: int) -> int:
    return context_length - MAX_ANSWER_TOKENS - SYSTEM_PROMPT_TOKENS


def _now() -> datetime:
    return datetime.now(UTC)


def _new_id() -> str:
    return str(uuid.uuid4())


def _commitment(tag: str, data: bytes) -> tuple[str, str]:
    """(nonce for chats.db, commitment for evidence). A fresh 32-byte nonce every time."""
    nonce = secrets.token_bytes(32)
    return b64url(nonce), tagged_hash(tag, nonce + data)


# ------------------------------------------------------------------ output shapes
def conversation_out(session: Session, conversations: list[Conversation]) -> list[ConversationOut]:
    by_conv: dict[str, list[ProviderMoveOut]] = {}
    for move in repo.moves(session, [c.id for c in conversations]):
        by_conv.setdefault(move.conversation_id, []).append(
            ProviderMoveOut(to=move.to_provider, at=move.at)
        )
    return [
        ConversationOut.model_validate(
            {
                **{k: getattr(c, k) for k in ConversationOut.model_fields if k != "moves"},
                "moves": by_conv.get(c.id, []),
            }
        )
        for c in conversations
    ]


def message_out(session: Session, messages: list[Message]) -> list[MessageOut]:
    seqs = repo.evidence_seqs(
        session, [m.evidence_outbox_id for m in messages if m.evidence_outbox_id]
    )
    out = []
    for m in messages:
        seq = seqs.get(m.evidence_outbox_id) if m.evidence_outbox_id else None
        out.append(
            MessageOut.model_validate(
                {
                    **{k: getattr(m, k) for k in MessageOut.model_fields if hasattr(m, k)},
                    "evidence_pending": m.evidence_outbox_id is not None and seq is None,
                    "evidence_seq": seq,
                    "previous_versions": json.loads(m.previous_versions or "[]"),
                }
            )
        )
    return out


# ------------------------------------------------------------------ conversations
def _conversation(session: Session, conversation_id: str) -> Conversation:
    conv = repo.get_conversation(session, conversation_id)
    if conv is None:
        raise not_found("conversation")
    return conv


def list_conversations(session: Session, project_id: str) -> list[ConversationOut]:
    if repo.get_project(session, project_id) is None:
        raise not_found("project")
    return conversation_out(session, list(repo.conversations(session, project_id)))


def create_conversation(
    session: Session, settings: Settings, project_id: str, title: str | None
) -> ConversationOut:
    project = repo.get_project(session, project_id)
    if project is None:
        raise not_found("project")
    use_company = settings.company_ai and project.company_ai_enabled
    provider = "company" if use_company else "local"
    conv = Conversation(
        id=_new_id(),
        project_id=project_id,
        title=(title or "").strip() or NEW_TITLE,
        classification_effective=project.classification,
        classification_source="review" if project.classification_source == "review" else "project",
        provider_mode=provider,
        current_provider=provider,
        model_id=None if use_company else repo.default_model_id(session),
        archived=False,
    )
    repo.add(session, conv)
    project.updated_at = _now()
    repo.record_event(
        session,
        "conversation_created",
        project_id=project_id,
        conversation_id=conv.id,
        body={
            "conversation_id": conv.id,
            "project_id": project_id,
            "classification": project.classification,
        },
    )
    return conversation_out(session, [conv])[0]


def update_conversation(
    session: Session,
    conversation_id: str,
    title: str | None,
    archived: bool | None,
    model_id: str | None,
) -> ConversationOut:
    conv = _conversation(session, conversation_id)
    if title is not None:
        conv.title = title.strip() or "Untitled conversation"
    if archived is not None:
        conv.archived = archived
    if model_id is not None:
        conv.model_id = model_id
    conv.updated_at = _now()
    session.flush()
    return conversation_out(session, [conv])[0]


def delete_conversation(session: Session, conversation_id: str) -> None:
    conv = _conversation(session, conversation_id)
    project_id = conv.project_id
    repo.delete(session, conv)
    repo.record_event(
        session,
        "conversation_deleted",
        project_id=project_id,
        conversation_id=conversation_id,
        body={"conversation_id": conversation_id, "project_id": project_id},
    )


def change_provider(
    session: Session, settings: Settings, conversation_id: str, to: str, confirmed: bool
) -> ConversationOut:
    """Local -> Company asks first and needs the operator flag; Company -> Local never asks."""
    conv = _conversation(session, conversation_id)
    current = conv.current_provider
    if current == to:
        return conversation_out(session, [conv])[0]
    if to == "company":
        if not settings.company_ai:
            raise AppError("company_provider_disabled", 409)
        if not confirmed:
            raise AppError("confirmation_required", 400)
        repo.record_event(
            session,
            "disclosure_confirmed",
            project_id=conv.project_id,
            conversation_id=conv.id,
            body={
                "conversation_id": conv.id,
                "provider": "company",
                "classification": conv.classification_effective,
            },
        )
    conv.current_provider = to
    conv.provider_mode = to
    conv.model_id = None if to == "company" else repo.default_model_id(session)
    conv.updated_at = _now()
    repo.add(session, ProviderMove(conversation_id=conv.id, to_provider=to))
    repo.record_event(
        session,
        "provider_changed",
        project_id=conv.project_id,
        conversation_id=conv.id,
        body={
            "conversation_id": conv.id,
            "from": current,
            "to": to,
            "history_sent": to == "company",
        },
    )
    return conversation_out(session, [conv])[0]


def list_messages(session: Session, conversation_id: str) -> list[MessageOut]:
    _conversation(session, conversation_id)
    return message_out(session, list(repo.messages(session, conversation_id)))


# ------------------------------------------------------------------ sending
def _ready_model(settings: Settings, answers: AnswerSource | None, conv: Conversation) -> ModelInfo:
    provider = conv.current_provider
    if provider == "company" and not settings.company_ai:
        raise AppError("company_provider_disabled", 409)
    if answers is None:
        raise AppError("no_model" if provider == "local" else "company_unreachable", 409)
    info = answers.model(provider, conv.model_id)
    if info is None:
        raise AppError("model_missing" if provider == "local" else "company_unreachable", 409)
    return info


def _generate(
    session: Session,
    answers: AnswerSource,
    info: ModelInfo,
    conv: Conversation,
    assistant: Message,
    context: list[dict[str, str]],
    regenerate: bool,
) -> None:
    parts: list[str] = []
    try:
        for chunk in answers.answer(conv.current_provider, info.model_id, context):
            parts.append(chunk)
        status = "complete"
    except Exception:
        status = "partial" if parts else "error"
    assistant.content = "".join(parts)
    assistant.status = status
    assistant.model_id = info.model_id
    assistant.prompt_tokens = (
        sum(estimate_tokens(m["content"]) for m in context) + SYSTEM_PROMPT_TOKENS
    )
    assistant.completion_tokens = estimate_tokens(assistant.content)

    input_nonce, input_commitment = _commitment(
        INPUT_TAG, jcs({"model": info.model_id, "messages": context})
    )
    output_nonce, output_commitment = _commitment(OUTPUT_TAG, assistant.content.encode("utf-8"))
    assistant.input_nonce, assistant.output_nonce = input_nonce, output_nonce
    event = repo.record_event(
        session,
        "inference_completed",
        project_id=conv.project_id,
        conversation_id=conv.id,
        body={
            "conversation_id": conv.id,
            "message_id": assistant.id,
            "provider": conv.current_provider,
            "model_id": info.model_id,
            "input_commitment": input_commitment,
            "output_commitment": output_commitment,
            "tokens_in": assistant.prompt_tokens,
            "tokens_out": assistant.completion_tokens,
            "status": EVIDENCE_STATUS[status],
            "regenerate": regenerate,
        },
    )
    assistant.evidence_outbox_id = event.id
    now = _now()
    conv.updated_at = now
    conv.last_message_preview = preview(assistant.content or context[-1]["content"])
    project = repo.get_project(session, conv.project_id)
    if project is not None:
        project.updated_at = now
    session.flush()


def _context(history: list[Message]) -> list[dict[str, str]]:
    return [
        {"role": m.role, "content": m.content}
        for m in history
        if m.content and m.status in ("complete", "partial", "stopped")
    ]


def send(
    session: Session,
    settings: Settings,
    answers: AnswerSource | None,
    conversation_id: str,
    text: str,
) -> Exchange:
    conv = _conversation(session, conversation_id)
    clean = text.strip()
    if not clean:
        raise AppError("empty_message", 422)
    info = _ready_model(settings, answers, conv)
    assert answers is not None  # checked by _ready_model

    if conv.current_provider == "local":
        needed, budget = estimate_tokens(clean), context_budget(info.context_length)
        if needed > budget:
            repo.record_event(
                session,
                "refusal",
                actor="app",
                project_id=conv.project_id,
                conversation_id=conv.id,
                body={"reason": "message_too_large", "tokens": needed, "budget": budget},
            )
            session.commit()  # the refusal is recorded even though the request fails
            raise AppError("message_too_large", 413)

    history = list(repo.messages(session, conv.id))
    position = repo.next_position(session, conv.id)
    common = {
        "conversation_id": conv.id,
        "classification_effective": conv.classification_effective,
        "classification_source": conv.classification_source,
        "provider": conv.current_provider,
        "model_id": info.model_id,
    }
    user = Message(
        id=_new_id(), position=position, role="user", content=clean, status="complete", **common
    )
    assistant = Message(
        id=_new_id(), position=position + 1, role="assistant", content="", status="error", **common
    )
    repo.add(session, user, assistant)
    if not history and conv.title == NEW_TITLE:
        conv.title = truncate(clean, 48)

    _generate(
        session,
        answers,
        info,
        conv,
        assistant,
        [*_context(history), {"role": "user", "content": clean}],
        False,
    )
    user_out, assistant_out = message_out(session, [user, assistant])
    return Exchange(user=user_out, assistant=assistant_out)


def regenerate(
    session: Session, settings: Settings, answers: AnswerSource | None, conversation_id: str
) -> Exchange:
    """Answer the last question again; the old answer is kept in ``previous_versions`` (A-03)."""
    conv = _conversation(session, conversation_id)
    history = list(repo.messages(session, conv.id))
    if len(history) < 2 or history[-1].role != "assistant" or history[-2].role != "user":
        raise AppError("nothing_to_regenerate", 409)
    info = _ready_model(settings, answers, conv)
    assert answers is not None
    last = history[-1]
    versions = json.loads(last.previous_versions or "[]")
    last.previous_versions = json.dumps([*versions, last.content])
    last.created_at = _now()
    _generate(session, answers, info, conv, last, _context(history[:-1]), True)
    return Exchange(user=None, assistant=message_out(session, [last])[0])


def providers_status(
    session: Session, settings: Settings, answers: AnswerSource | None
) -> ProvidersStatus:
    local = (
        answers is not None and answers.model("local", repo.default_model_id(session)) is not None
    )
    return ProvidersStatus(local_ready=local, company_enabled=settings.company_ai)
