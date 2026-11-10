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
import uuid
from collections.abc import Callable, Iterator
from datetime import UTC, datetime

from sqlalchemy.orm import Session

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
)
from aios_backend.config import Settings
from aios_backend.errors import AppError, not_found
from aios_backend.runtime import STOP_WAIT_SECONDS, Busy, Generation, Generations
from aios_common.canonical import b64url, jcs, tagged_hash
from db.models import Conversation, Message, ProviderMove
from db.session import Database

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
) -> tuple[str, str]:
    """Collect the answer. Returns (text, status): complete, stopped, partial or error."""
    parts: list[str] = []
    chunks = answers.answer(provider, info.model_id, context)
    try:
        for chunk in chunks:
            if generation.cancel.is_set():
                return "".join(parts), "stopped"
            generation.phase = "streaming"
            parts.append(chunk)
            if on_chunk is not None:
                on_chunk(chunk)
        return "".join(parts), "stopped" if generation.cancel.is_set() else "complete"
    except Exception:
        return "".join(parts), "partial" if parts else "error"
    finally:
        close = getattr(chunks, "close", None)
        if callable(close):
            close()


def _finish(
    session: Session,
    info: ModelInfo,
    conv: Conversation,
    assistant: Message,
    context: list[dict[str, str]],
    content: str,
    status: str,
    regenerate: bool,
) -> None:
    """Store the answer and queue the content-free ``inference_completed`` event."""
    assistant.content = content
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
        content, status = _produce(answers, info, conv.current_provider, context, generation)
        _finish(session, info, conv, assistant, context, content, status, regenerate)
        result = message_out(session, [assistant])[0]
        return result
    finally:
        generations.end(generation, result)


def _context(history: list[Message]) -> list[dict[str, str]]:
    return [
        {"role": m.role, "content": m.content}
        for m in history
        if m.content and m.status in ("complete", "partial", "stopped")
    ]


def _check_size(session: Session, conv: Conversation, info: ModelInfo, text: str) -> None:
    """A local message that cannot fit the model's context is refused, and the refusal recorded."""
    if conv.current_provider != "local":
        return
    needed, budget = estimate_tokens(text), context_budget(info.context_length)
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


def _new_exchange(
    session: Session, conv: Conversation, info: ModelInfo, text: str
) -> tuple[Message, Message, list[dict[str, str]]]:
    """Add the user's message and an empty answer; returns them with the context to send."""
    history = list(repo.messages(session, conv.id))
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
    return user, assistant, [*_context(history), {"role": "user", "content": text}]


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
) -> Exchange:
    conv = _conversation(session, conversation_id)
    clean = _clean(text)
    info = _ready_model(settings, answers, conv)
    assert answers is not None  # checked by _ready_model
    _check_size(session, conv, info, clean)
    if generations.busy():
        raise AppError("busy", 409)
    user, assistant, context = _new_exchange(session, conv, info, clean)
    assistant_out = _generate(session, answers, generations, info, conv, assistant, context, False)
    return Exchange(user=message_out(session, [user])[0], assistant=assistant_out)


def _regenerate_target(
    session: Session, conv: Conversation
) -> tuple[Message, list[dict[str, str]]]:
    history = list(repo.messages(session, conv.id))
    if len(history) < 2 or history[-1].role != "assistant" or history[-2].role != "user":
        raise AppError("nothing_to_regenerate", 409)
    return history[-1], _context(history[:-1])


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
) -> Exchange:
    """Answer the last question again; the old answer is kept in ``previous_versions`` (A-03)."""
    conv = _conversation(session, conversation_id)
    last, context = _regenerate_target(session, conv)
    info = _ready_model(settings, answers, conv)
    assert answers is not None
    if generations.busy():
        raise AppError("busy", 409)
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

    def work() -> None:
        result: MessageOut | None = None
        try:
            content, status = _produce(answers, info, provider, context, generation, on_chunk)
            with db.session() as session:
                conv = repo.get_conversation(session, conversation_id)
                assistant = session.get(Message, assistant_id)
                if conv is None or assistant is None:
                    events.put(("error", {"error": "conversation_not_found"}))
                    return
                _finish(session, info, conv, assistant, context, content, status, regenerate)
                result = message_out(session, [assistant])[0]
                session.commit()
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
) -> Iterator[str]:
    """Checks run before the stream starts, so they still answer with an HTTP error."""
    with db.session() as session:
        conv = _conversation(session, conversation_id)
        clean = _clean(text)
        info = _ready_model(settings, answers, conv)
        assert answers is not None
        _check_size(session, conv, info, clean)
        if generations.busy():
            raise AppError("busy", 409)
        user, assistant, context = _new_exchange(session, conv, info, clean)
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
) -> Iterator[str]:
    with db.session() as session:
        conv = _conversation(session, conversation_id)
        last, context = _regenerate_target(session, conv)
        info = _ready_model(settings, answers, conv)
        assert answers is not None
        if generations.busy():
            raise AppError("busy", 409)
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
        session, answers, generations, info, conv, assistant, _context(history), False
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
