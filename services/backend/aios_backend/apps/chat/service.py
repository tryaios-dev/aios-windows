"""Chat rules: conversations, provider moves (M-09), sending and regenerating, commitments.

Answers come from an ``AnswerSource`` (see answers.py); chat only decides whether a message
may be sent, stores both sides, and queues the content-free ``inference_completed`` event with
hiding commitments (Evidence Wire Format v1, section 8). The commitment nonces stay in chats.db.
"""

import json
import math
import queue
import re
import secrets
import threading
import time
import uuid
from collections.abc import Callable, Iterator
from datetime import UTC, datetime

from sqlalchemy.orm import Session, sessionmaker

from aios_backend import linked_config as linked
from aios_backend.apps.chat import repository as repo
from aios_backend.apps.chat.answers import AnswerSource, ModelInfo
from aios_backend.apps.chat.schemas import (
    CompanyStatus,
    ContinueOut,
    ConversationOut,
    Exchange,
    GenerationOut,
    MessageOut,
    ProviderMoveOut,
    ProvidersStatus,
    SummaryOut,
)
from aios_backend.config import Settings
from aios_backend.errors import AppError, not_found
from aios_backend.runtime import STOP_WAIT_SECONDS, Busy, Generation, Generations
from aios_common.canonical import b64url, jcs, tagged_hash
from aios_common.logging import get_logger, log_event
from db.models import Conversation, Message, ProviderMove, Summary
from db.session import Database

MAX_ANSWER_TOKENS = 1500
# Providers whose answers come from outside this computer: moving there asks first (PR-03).
LEAVES = frozenset({"company", "resource"})
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


Count = Callable[[str], int]
# MVP 11.2: without the engine's count, estimate with a safety margin (a tokenizer can make more
# tokens of a text than characters / 3.5).
ESTIMATE_MARGIN = 1.2


def safe_estimate(text: str) -> int:
    return math.ceil(estimate_tokens(text) * ESTIMATE_MARGIN)


def token_counter(answers: AnswerSource, provider: str, model_id: str) -> Count:
    """Tokens as the model counts them (G-04): the engine's own tokenizer while it has the model
    loaded (``count_tokens`` on the answer source), otherwise the estimate with its safety margin.
    Counting never starts the engine. After one miss the rest of the request uses the estimate."""
    count_tokens = getattr(answers, "count_tokens", None)
    exact = callable(count_tokens)
    known: dict[str, int] = {}

    def count(text: str) -> int:
        nonlocal exact
        if not exact:
            return safe_estimate(text)
        if text not in known:
            try:
                n = count_tokens(provider, model_id, text)  # type: ignore[misc]
            except Exception:
                n = None
            if not isinstance(n, int):
                exact = False
                return safe_estimate(text)
            known[text] = n
        return known[text]

    return count


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


# How often an answer being written is saved, so a crash keeps the words so far (G-03).
SAVE_EVERY_S = 1.0

log = get_logger("chat")


def _sent(
    answers: AnswerSource, provider: str, messages: list[dict[str, str]]
) -> list[dict[str, str]]:
    """The messages exactly as the source will send them (with its own system prompt, if it adds
    one), so the input commitment covers the bytes the model received (G-03)."""
    prepare = getattr(answers, "prepare", None)
    return list(prepare(provider, messages)) if callable(prepare) else messages


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


def get_conversation(session: Session, conversation_id: str) -> ConversationOut:
    return conversation_out(session, [_conversation(session, conversation_id)])[0]


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
    """Moving to Company (needs the operator flag) or to a linked resource (needs a resource
    linked on the Resources page) asks first; moving back to Local never asks."""
    conv = _conversation(session, conversation_id)
    current = conv.current_provider
    if current == to:
        return conversation_out(session, [conv])[0]
    leaves = to in LEAVES
    if to == "company" and not settings.company_ai:
        raise AppError("company_provider_disabled", 409)
    if to == "resource" and linked.linked_id() is None:
        raise AppError("resource_not_linked", 409)
    if leaves:
        if not confirmed:
            raise AppError("confirmation_required", 400)
        repo.record_event(
            session,
            "disclosure_confirmed",
            project_id=conv.project_id,
            conversation_id=conv.id,
            body={
                "conversation_id": conv.id,
                "provider": to,
                "classification": conv.classification_effective,
            },
        )
    conv.current_provider = to
    conv.provider_mode = to
    conv.model_id = None if leaves else repo.default_model_id(session)
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
            "history_sent": leaves,
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
    if provider == "resource" and linked.linked_id() is None:
        raise AppError("resource_not_linked", 409)
    if answers is None:
        raise AppError("no_model" if provider == "local" else f"{provider}_unreachable", 409)
    info = answers.model(provider, conv.model_id)
    if info is None:
        raise AppError("model_missing" if provider == "local" else f"{provider}_unreachable", 409)
    return info


def _allow_once(session: Session, conv: Conversation, allowed: bool) -> None:
    """A linked resource is asked every time (Resources page: "Each time, AIOS shows you exactly
    what would be sent and where, and waits for you to allow it"). Each allowed send is recorded."""
    if conv.current_provider != "resource":
        return
    if not allowed:
        raise AppError("allow_once_required", 400)
    repo.record_event(
        session,
        "disclosure_confirmed",
        project_id=conv.project_id,
        conversation_id=conv.id,
        body={
            "conversation_id": conv.id,
            "provider": "resource",
            "classification": conv.classification_effective,
        },
    )


def _begin(generations: Generations, conv: Conversation, message_id: str) -> Generation:
    try:
        return generations.begin(conv.id, message_id, conv.current_provider)
    except Busy as exc:
        raise AppError("busy", 409) from exc


def _produce(
    answers: AnswerSource,
    info: ModelInfo,
    provider: str,
    context: list[dict[str, str]],
    generation: Generation,
    on_chunk: Callable[[str], None] | None = None,
) -> tuple[str, str, tuple[int, int] | None]:
    """Collect the answer. Returns (text, status, usage): status is complete, stopped, partial or
    error; usage is the engine's own (prompt, completion) token counts when it reported them."""
    parts: list[str] = []
    chunks = answers.answer(provider, info.model_id, context)
    try:
        for chunk in chunks:
            if generation.cancel.is_set():
                return "".join(parts), "stopped", None
            generation.phase = "streaming"
            parts.append(chunk)
            generation.text += chunk
            if on_chunk is not None:
                on_chunk(chunk)
        status = "stopped" if generation.cancel.is_set() else "complete"
        return "".join(parts), status, _usage(chunks)
    except Exception:
        return "".join(parts), "partial" if parts else "error", None
    finally:
        close = getattr(chunks, "close", None)
        if callable(close):
            close()


def _usage(chunks: object) -> tuple[int, int] | None:
    usage = getattr(chunks, "usage", None)
    if isinstance(usage, tuple) and len(usage) == 2 and all(isinstance(n, int) for n in usage):
        return usage[0], usage[1]
    return None


def _saver(save: Callable[[str], None], generation: Generation) -> Callable[[str], None]:
    """Save the answer so far at most every SAVE_EVERY_S seconds while it is written."""
    last = [time.monotonic()]

    def on_chunk(_chunk: str) -> None:
        now = time.monotonic()
        if now - last[0] >= SAVE_EVERY_S:
            last[0] = now
            try:
                save(generation.text)
            except Exception:
                # A failed save never ends the answer; the next save or ``_finish`` stores it.
                log_event(log, "answer_save_failed")

    return on_chunk


def _finish(
    session: Session,
    info: ModelInfo,
    conv: Conversation,
    assistant: Message,
    context: list[dict[str, str]],
    content: str,
    status: str,
    regenerate: bool,
    usage: tuple[int, int] | None = None,
) -> None:
    """Store the answer and queue the content-free ``inference_completed`` event. ``context`` is
    what was sent (``_sent``); ``usage`` the engine's token counts, else an estimate."""
    assistant.content = content
    assistant.status = status
    assistant.model_id = info.model_id
    if usage is not None:
        assistant.prompt_tokens, assistant.completion_tokens = usage
    else:
        has_prompt = bool(context) and context[0]["role"] == "system"
        assistant.prompt_tokens = sum(estimate_tokens(m["content"]) for m in context) + (
            0 if has_prompt else SYSTEM_PROMPT_TOKENS
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


def _generate(
    session: Session,
    answers: AnswerSource,
    generations: Generations,
    info: ModelInfo,
    conv: Conversation,
    assistant: Message,
    context: list[dict[str, str]],
    regenerate: bool,
) -> MessageOut:
    """Produce and store a whole answer in this request. Stop can end it early."""
    generation = _begin(generations, conv, assistant.id)
    result: MessageOut | None = None
    try:
        sent = _sent(answers, conv.current_provider, context)
        assistant.status = "partial"  # what is left if the process stops mid-answer
        session.commit()

        def save(text: str) -> None:
            assistant.content = text
            session.commit()

        content, status, usage = _produce(
            answers, info, conv.current_provider, sent, generation, _saver(save, generation)
        )
        _finish(session, info, conv, assistant, sent, content, status, regenerate, usage)
        result = message_out(session, [assistant])[0]
        session.commit()  # stored before the summary job reads the conversation
        sessions = sessionmaker(bind=session.get_bind(), expire_on_commit=False)
        _refresh_later(sessions, answers, generations, conv.id, info)
        return result
    finally:
        generations.end(generation, result)


def _usable(history: list[Message]) -> list[Message]:
    return [m for m in history if m.content and m.status in ("complete", "partial", "stopped")]


def _context(history: list[Message]) -> list[dict[str, str]]:
    return [{"role": m.role, "content": m.content} for m in _usable(history)]


# ------------------------------------------------------------------ long conversations (M-07)
SUMMARY_INSTRUCTION = (
    "Summarise the conversation below so the assistant can carry on helping without it. Keep "
    "names, figures, dates, decisions and open questions. Plain sentences, at most 200 words."
)
SUMMARY_NOTE = "Summary of the earlier part of this conversation:\n"
SUMMARY_MAX_TOKENS = 400  # about 300 words: a longer summary is cut at its last full sentence


def _summary_note(summary: Summary | None) -> list[dict[str, str]]:
    return [{"role": "system", "content": SUMMARY_NOTE + summary.content}] if summary else []


def _tokens(messages: list[Message], count: Count) -> int:
    return sum(count(m.content) for m in messages)


def _fit_history(
    session: Session,
    answers: AnswerSource,
    info: ModelInfo,
    conv: Conversation,
    history: list[Message],
    reserve: int = 0,
    count: Count | None = None,
) -> list[dict[str, str]]:
    """The context for a request, rebuilt each time (M-07, MVP 11.2): the latest summary, then
    the messages after it, newest to oldest while they fit. Nothing is summarised here, so the
    answer starts at once; ``refresh_summary`` runs in the background after the answer.

    ``reserve``: tokens kept free for what follows (the question being sent now). The newest
    message is always kept, so a regenerated answer still sees the question it answers.
    ``count``: how tokens are counted (G-04, ``token_counter``).
    """
    count = count or token_counter(answers, conv.current_provider, info.model_id)
    budget = max(context_budget(info.context_length) - reserve, 0)
    summary, after = _after_summary(session, conv, history)
    note = count(SUMMARY_NOTE + summary.content) if summary else 0
    keep = _newest_within(after, budget - note, count)
    return _summary_note(summary) + _context(keep)


def _after_summary(
    session: Session, conv: Conversation, history: list[Message]
) -> tuple[Summary | None, list[Message]]:
    """The latest summary and the usable messages it does not cover."""
    usable = _usable(history)
    summary = repo.latest_summary(session, conv.id)
    if summary is None:
        return None, usable
    ids = [m.id for m in usable]
    if summary.covers_until_message_id in ids:
        return summary, usable[ids.index(summary.covers_until_message_id) + 1 :]
    return summary, usable


def _newest_within(messages: list[Message], room: int, count: Count) -> list[Message]:
    """The newest messages whose tokens fit ``room``; always at least the newest one."""
    keep: list[Message] = []
    used = 0
    for m in reversed(messages):
        cost = count(m.content)
        if keep and used + cost > room:
            break
        keep.insert(0, m)
        used += cost
    return keep


def refresh_summary(
    session: Session, answers: AnswerSource, info: ModelInfo, conv: Conversation
) -> Summary | None:
    """After an answer (MVP 11.2): once the messages after the latest summary take more than
    three quarters of the budget, summarise all but the newest quarter. The next request then has
    a current summary and room for the question, and the next refresh is half a budget of new
    messages away (not after every answer). Returns the new summary, or None."""
    count = token_counter(answers, conv.current_provider, info.model_id)
    budget = context_budget(info.context_length)
    summary, after = _after_summary(session, conv, list(repo.messages(session, conv.id)))
    note = count(SUMMARY_NOTE + summary.content) if summary else 0
    if note + _tokens(after, count) <= budget * 3 // 4:
        return None
    keep = _newest_within(after, budget // 4, count)
    older = after[: len(after) - len(keep)]
    return _summarise(session, answers, info, conv, summary, older) if older else None


def _refresh_later(
    sessions: Callable[[], Session],
    answers: AnswerSource,
    generations: Generations,
    conversation_id: str,
    info: ModelInfo,
) -> None:
    """Refresh the conversation's summary in the background, after the answer is stored."""

    def work() -> None:
        with sessions() as session:
            conv = repo.get_conversation(session, conversation_id)
            if conv is not None and refresh_summary(session, answers, info, conv) is not None:
                session.commit()

    generations.background.start(conversation_id, work)


def _capped(chunks: Iterator[str]) -> str:
    """The summary text, at most ``SUMMARY_MAX_TOKENS``: past the cap the request is closed (the
    engine stops) and the text ends at its last full sentence."""
    parts: list[str] = []
    length = 0
    limit = int(SUMMARY_MAX_TOKENS * 3.5)
    try:
        for chunk in chunks:
            parts.append(chunk)
            length += len(chunk)
            if length > limit:
                text = "".join(parts)[:limit]
                end = max(text.rfind(". "), text.rfind(".\n"))
                return (text[: end + 1] if end > 0 else text).strip()
    finally:
        close = getattr(chunks, "close", None)
        if callable(close):
            close()
    return "".join(parts).strip()


def _summarise(
    session: Session,
    answers: AnswerSource,
    info: ModelInfo,
    conv: Conversation,
    previous: Summary | None,
    older: list[Message],
) -> Summary | None:
    """Summarise ``older`` (after the previous summary) with the same model, through the router
    and the gateway like any answer. Stored, and recorded as a content-free inference event.
    Returns None when the model gave nothing; the request then goes on with the newest messages.
    """
    lines = [f"Earlier summary: {previous.content}"] if previous else []
    lines += [f"{'User' if m.role == 'user' else 'Assistant'}: {m.content}" for m in older]
    room = context_budget(info.context_length) - estimate_tokens(SUMMARY_INSTRUCTION)
    transcript = "\n\n".join(lines)
    if estimate_tokens(transcript) > room:  # keep the most recent part that fits
        transcript = transcript[-int(room * 3.5) :]
    messages = [
        {"role": "system", "content": SUMMARY_INSTRUCTION},
        {"role": "user", "content": transcript},
    ]
    messages = _sent(answers, conv.current_provider, messages)
    try:
        text = _capped(answers.answer(conv.current_provider, info.model_id, messages))
    except Exception:
        return None
    if not text:
        return None
    summary = Summary(
        id=_new_id(),
        conversation_id=conv.id,
        covers_until_message_id=older[-1].id,
        content=text,
        classification_effective=conv.classification_effective,
        classification_source=conv.classification_source,
        model_id=info.model_id,
        provider=conv.current_provider,
    )
    repo.add(session, summary)
    _, input_commitment = _commitment(
        INPUT_TAG, jcs({"model": info.model_id, "messages": messages})
    )
    _, output_commitment = _commitment(OUTPUT_TAG, text.encode("utf-8"))
    repo.record_event(
        session,
        "inference_completed",
        project_id=conv.project_id,
        conversation_id=conv.id,
        body={
            "conversation_id": conv.id,
            "message_id": summary.id,
            "provider": conv.current_provider,
            "model_id": info.model_id,
            "input_commitment": input_commitment,
            "output_commitment": output_commitment,
            "tokens_in": sum(estimate_tokens(m["content"]) for m in messages),
            "tokens_out": estimate_tokens(text),
            "status": "ok",
            "regenerate": False,
            "purpose": "summary",
        },
    )
    session.flush()
    return summary


def summary_of(session: Session, conversation_id: str) -> SummaryOut | None:
    _conversation(session, conversation_id)
    row = repo.latest_summary(session, conversation_id)
    if row is None:
        return None
    return SummaryOut(
        id=row.id,
        conversation_id=row.conversation_id,
        covers_until_message_id=row.covers_until_message_id,
        content=row.content,
        classification_effective=row.classification_effective,
        classification_source=row.classification_source,
        model_id=row.model_id,
        provider=row.provider,
        created_at=row.created_at,
    )


def _check_size(
    session: Session, conv: Conversation, info: ModelInfo, text: str, count: Count = estimate_tokens
) -> None:
    """A local message that cannot fit the model's context is refused, and the refusal recorded."""
    if conv.current_provider != "local":
        return
    needed, budget = count(text), context_budget(info.context_length)
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


KNOWLEDGE_NOTE = (
    "The person chose these documents from My secure knowledge for this question. Answer from "
    "them when they are relevant and say which document you used.\n"
)
KNOWLEDGE_SHARE = 2  # documents take at most 1/2 of the context budget


SKILLS_NOTE = "Skills the person has turned on. Follow each one when it applies:\n"


def _skills_note(session: Session) -> str | None:
    """The instructions of the skills that are on (Add skills to my AI)."""
    instructions = [i for i in repo.enabled_skill_instructions(session) if i.strip()]
    return SKILLS_NOTE + "\n".join(f"- {i.strip()}" for i in instructions) if instructions else None


def _knowledge_note(
    session: Session, info: ModelInfo, knowledge_ids: list[str] | None
) -> str | None:
    """The chosen documents' text as one note, cut to fit; unknown ids are refused."""
    ids = list(dict.fromkeys(knowledge_ids or []))
    if not ids:
        return None
    docs = repo.knowledge_docs(session, ids)
    if len(docs) != len(ids):
        raise not_found("document")
    ready = [d for d in docs if d.status == "ready" and d.text.strip()]
    if not ready:
        return None
    room = context_budget(info.context_length) // KNOWLEDGE_SHARE - estimate_tokens(KNOWLEDGE_NOTE)
    each = max(room // len(ready), 0) * 3  # about 3 characters a token
    parts = []
    for doc in ready:
        body = doc.text.strip()
        if len(body) > each:
            body = body[:each].rstrip() + "\n[The rest of this document did not fit.]"
        parts.append(f"--- {doc.name} ---\n{body}")
    return KNOWLEDGE_NOTE + "\n\n".join(parts)


def _new_exchange(
    session: Session,
    answers: AnswerSource,
    conv: Conversation,
    info: ModelInfo,
    text: str,
    knowledge_ids: list[str] | None = None,
    count: Count | None = None,
) -> tuple[Message, Message, list[dict[str, str]]]:
    """Add the user's message and an empty answer; returns them with the context to send."""
    count = count or token_counter(answers, conv.current_provider, info.model_id)
    notes = [n for n in (_skills_note(session), _knowledge_note(session, info, knowledge_ids)) if n]
    extra = "\n\n".join(notes)
    reserve = count(text) + (count(extra) if extra else 0)
    history = list(repo.messages(session, conv.id))
    earlier = _fit_history(session, answers, info, conv, history, reserve=reserve, count=count)
    if extra:
        if earlier and earlier[0]["role"] == "system":  # one note: skills, documents, summary
            earlier[0] = {"role": "system", "content": f"{extra}\n\n{earlier[0]['content']}"}
        else:
            earlier.insert(0, {"role": "system", "content": extra})
    position = repo.next_position(session, conv.id)
    common = _message_common(conv, info)
    user = Message(
        id=_new_id(), position=position, role="user", content=text, status="complete", **common
    )
    assistant = Message(
        id=_new_id(), position=position + 1, role="assistant", content="", status="error", **common
    )
    repo.add(session, user, assistant)
    if not history and conv.title == NEW_TITLE:
        conv.title = truncate(text, 48)
    return user, assistant, [*earlier, {"role": "user", "content": text}]


def _message_common(conv: Conversation, info: ModelInfo) -> dict[str, str]:
    return {
        "conversation_id": conv.id,
        "classification_effective": conv.classification_effective,
        "classification_source": conv.classification_source,
        "provider": conv.current_provider,
        "model_id": info.model_id,
    }


def _clean(text: str) -> str:
    clean = text.strip()
    if not clean:
        raise AppError("empty_message", 422)
    return clean


def send(
    session: Session,
    settings: Settings,
    answers: AnswerSource | None,
    generations: Generations,
    conversation_id: str,
    text: str,
    knowledge_ids: list[str] | None = None,
    allowed: bool = False,
) -> Exchange:
    conv = _conversation(session, conversation_id)
    clean = _clean(text)
    info = _ready_model(settings, answers, conv)
    _allow_once(session, conv, allowed)
    assert answers is not None  # checked by _ready_model
    count = token_counter(answers, conv.current_provider, info.model_id)
    _check_size(session, conv, info, clean, count)
    if generations.busy():
        raise AppError("busy", 409)
    user, assistant, context = _new_exchange(
        session, answers, conv, info, clean, knowledge_ids, count
    )
    assistant_out = _generate(session, answers, generations, info, conv, assistant, context, False)
    return Exchange(user=message_out(session, [user])[0], assistant=assistant_out)


def _regenerate_target(session: Session, conv: Conversation) -> tuple[Message, list[Message]]:
    history = list(repo.messages(session, conv.id))
    if len(history) < 2 or history[-1].role != "assistant" or history[-2].role != "user":
        raise AppError("nothing_to_regenerate", 409)
    return history[-1], history[:-1]


def _keep_previous_version(last: Message) -> None:
    versions = json.loads(last.previous_versions or "[]")
    last.previous_versions = json.dumps([*versions, last.content])
    last.created_at = _now()


def regenerate(
    session: Session,
    settings: Settings,
    answers: AnswerSource | None,
    generations: Generations,
    conversation_id: str,
    allowed: bool = False,
) -> Exchange:
    """Answer the last question again; the old answer is kept in ``previous_versions`` (A-03)."""
    conv = _conversation(session, conversation_id)
    last, earlier = _regenerate_target(session, conv)
    info = _ready_model(settings, answers, conv)
    _allow_once(session, conv, allowed)
    assert answers is not None
    if generations.busy():
        raise AppError("busy", 409)
    context = _fit_history(session, answers, info, conv, earlier)
    _keep_previous_version(last)
    assistant_out = _generate(session, answers, generations, info, conv, last, context, True)
    return Exchange(user=None, assistant=assistant_out)


# ------------------------------------------------------------------ streaming
def _sse(event: str, data: object) -> str:
    """One Server-Sent Events frame. Electron main reads these and forwards them over IPC."""
    return f"event: {event}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n"


def _stream(
    db: Database,
    answers: AnswerSource,
    generations: Generations,
    generation: Generation,
    info: ModelInfo,
    conversation_id: str,
    assistant_id: str,
    provider: str,
    context: list[dict[str, str]],
    regenerate: bool,
    started: dict[str, object],
) -> Iterator[str]:
    """Generate in a worker thread; the response streams what it produces.

    The answer is stored even if the client goes away mid-way, so nothing is lost.
    """
    events: queue.Queue[tuple[str, object] | None] = queue.Queue()
    first_chunk = threading.Event()

    def on_chunk(chunk: str) -> None:
        if not first_chunk.is_set():
            first_chunk.set()
            events.put(("phase", {"phase": "streaming"}))
        events.put(("delta", {"text": chunk}))

    def save(text: str) -> None:
        with db.session() as session:
            row = session.get(Message, assistant_id)
            if row is not None:
                row.content = text
                session.commit()

    keep = _saver(save, generation)

    def on_chunk_and_save(chunk: str) -> None:
        on_chunk(chunk)
        keep(chunk)

    def work() -> None:
        result: MessageOut | None = None
        try:
            sent = _sent(answers, provider, context)
            content, status, usage = _produce(
                answers, info, provider, sent, generation, on_chunk_and_save
            )
            with db.session() as session:
                conv = repo.get_conversation(session, conversation_id)
                assistant = session.get(Message, assistant_id)
                if conv is None or assistant is None:
                    events.put(("error", {"error": "conversation_not_found"}))
                    return
                _finish(session, info, conv, assistant, sent, content, status, regenerate, usage)
                result = message_out(session, [assistant])[0]
                session.commit()
            _refresh_later(db.session, answers, generations, conversation_id, info)
            data = {"assistant": result.model_dump(mode="json")}
            if status in ("partial", "error"):
                events.put(("error", {"error": "answer_interrupted", **data}))
            else:
                events.put(("done", data))
        except Exception:
            events.put(("error", {"error": "internal_error"}))
        finally:
            generations.end(generation, result)
            events.put(None)

    threading.Thread(target=work, name="aios-generation", daemon=True).start()

    def frames() -> Iterator[str]:
        yield _sse("started", started)
        yield _sse("phase", {"phase": "preparing"})
        while (item := events.get()) is not None:
            yield _sse(*item)

    return frames()


def stream_send(
    db: Database,
    settings: Settings,
    answers: AnswerSource | None,
    generations: Generations,
    conversation_id: str,
    text: str,
    knowledge_ids: list[str] | None = None,
    allowed: bool = False,
) -> Iterator[str]:
    """Checks run before the stream starts, so they still answer with an HTTP error."""
    with db.session() as session:
        conv = _conversation(session, conversation_id)
        clean = _clean(text)
        info = _ready_model(settings, answers, conv)
        _allow_once(session, conv, allowed)
        assert answers is not None
        count = token_counter(answers, conv.current_provider, info.model_id)
        _check_size(session, conv, info, clean, count)
        if generations.busy():
            raise AppError("busy", 409)
        user, assistant, context = _new_exchange(
            session, answers, conv, info, clean, knowledge_ids, count
        )
        assistant.status = "partial"  # what is left if the process stops mid-answer
        generation = _begin(generations, conv, assistant.id)
        try:
            session.commit()
            user_out = message_out(session, [user])[0]
        except Exception:
            generations.end(generation)
            raise
        provider = conv.current_provider
    started: dict[str, object] = {
        "user": user_out.model_dump(mode="json"),
        "assistant_id": assistant.id,
    }
    return _stream(
        db,
        answers,
        generations,
        generation,
        info,
        conversation_id,
        assistant.id,
        provider,
        context,
        False,
        started,
    )


def stream_regenerate(
    db: Database,
    settings: Settings,
    answers: AnswerSource | None,
    generations: Generations,
    conversation_id: str,
    allowed: bool = False,
) -> Iterator[str]:
    with db.session() as session:
        conv = _conversation(session, conversation_id)
        last, earlier = _regenerate_target(session, conv)
        info = _ready_model(settings, answers, conv)
        _allow_once(session, conv, allowed)
        assert answers is not None
        if generations.busy():
            raise AppError("busy", 409)
        context = _fit_history(session, answers, info, conv, earlier)
        generation = _begin(generations, conv, last.id)
        try:
            _keep_previous_version(last)
            last.content, last.status = "", "partial"
            session.commit()
        except Exception:
            generations.end(generation)
            raise
        provider, assistant_id = conv.current_provider, last.id
    return _stream(
        db,
        answers,
        generations,
        generation,
        info,
        conversation_id,
        assistant_id,
        provider,
        context,
        True,
        {"user": None, "assistant_id": assistant_id},
    )


# ------------------------------------------------------------------ stop and state
def stop(generations: Generations, conversation_id: str) -> MessageOut:
    """Ask the running answer to end; the words so far are kept with status ``stopped``."""
    generation = generations.for_conversation(conversation_id)
    if generation is None:
        raise AppError("not_generating", 409)
    generation.cancel.set()
    if not generation.finished.wait(STOP_WAIT_SECONDS) or generation.result is None:
        raise AppError("stop_timeout", 504)
    result: MessageOut = generation.result
    return result


def generation_state(
    session: Session, generations: Generations, conversation_id: str
) -> GenerationOut:
    _conversation(session, conversation_id)
    current = generations.for_conversation(conversation_id)
    if current is None:
        return GenerationOut(generating=False, message_id=None, phase=None, provider=None)
    return GenerationOut(
        generating=True,
        message_id=current.message_id,
        phase=current.phase,
        provider=current.provider,
        text=current.text,
    )


# ------------------------------------------------------------------ continue locally (M-09)
def _local_model(
    session: Session, answers: AnswerSource | None, conv: Conversation
) -> tuple[str | None, ModelInfo]:
    model_id = conv.model_id if conv.current_provider == "local" else repo.default_model_id(session)
    info = answers.model("local", model_id) if answers is not None else None
    if info is None:
        raise AppError("model_missing" if model_id else "no_model", 409)
    return model_id, info


def continue_locally(
    session: Session,
    settings: Settings,
    answers: AnswerSource | None,
    generations: Generations,
    conversation_id: str,
    partial_message_id: str | None,
    text: str | None,
) -> ContinueOut:
    """Move to Local (never asks) and carry on there: an interrupted answer, or a pending send."""
    if (partial_message_id is None) == (text is None):
        raise AppError("invalid_request", 422)
    conv = _conversation(session, conversation_id)
    _, info = _local_model(session, answers, conv)
    assert answers is not None
    if generations.busy():
        raise AppError("busy", 409)

    partial: Message | None = None
    if partial_message_id is not None:
        partial = session.get(Message, partial_message_id)
        if partial is None or partial.conversation_id != conv.id or partial.role != "assistant":
            raise not_found("message")
        if partial.status not in ("partial", "stopped", "error"):
            raise AppError("not_partial", 409)

    if conv.current_provider != "local":
        change_provider(session, settings, conv.id, "local", True)
        conv.model_id = info.model_id

    if text is not None:
        exchange = send(session, settings, answers, generations, conv.id, text)
        return ContinueOut(
            conversation=conversation_out(session, [conv])[0],
            user=exchange.user,
            assistant=exchange.assistant,
        )

    assert partial is not None
    history = [m for m in repo.messages(session, conv.id) if m.position <= partial.position]
    assistant = Message(
        id=_new_id(),
        position=repo.next_position(session, conv.id),
        role="assistant",
        content="",
        status="error",
        continued_from=partial.id,
        **_message_common(conv, info),
    )
    repo.add(session, assistant)
    repo.record_event(
        session,
        "continuation",
        project_id=conv.project_id,
        conversation_id=conv.id,
        body={
            "reason": "local_continuation",
            "conversation_id": conv.id,
            "message_id": assistant.id,
            "continued_from": partial.id,
        },
    )
    assistant_out = _generate(
        session,
        answers,
        generations,
        info,
        conv,
        assistant,
        _fit_history(session, answers, info, conv, history),
        False,
    )
    return ContinueOut(
        conversation=conversation_out(session, [conv])[0], user=None, assistant=assistant_out
    )


# ------------------------------------------------------------------ providers
def providers_status(
    session: Session, settings: Settings, answers: AnswerSource | None
) -> ProvidersStatus:
    local = (
        answers is not None and answers.model("local", repo.default_model_id(session)) is not None
    )
    company = None
    if settings.company_ai:
        company = CompanyStatus(
            reachable=answers is not None and answers.model("company", None) is not None,
            base_url=settings.company_base_url,
            model_name=settings.company_model_name,
            checked_at=_now(),
        )
    return ProvidersStatus(local_ready=local, company_enabled=settings.company_ai, company=company)
