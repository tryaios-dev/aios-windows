"""HTTP endpoints for conversations and messages (MVP 9.3). Thin: validate, call the service."""

from fastapi import APIRouter, status
from fastapi.responses import StreamingResponse

from aios_backend.apps.chat import service
from aios_backend.apps.chat.answers import Answers
from aios_backend.apps.chat.schemas import (
    ContinueIn,
    ContinueOut,
    ConversationCreate,
    ConversationOut,
    ConversationPatch,
    Exchange,
    GenerationOut,
    MessageOut,
    ProviderChange,
    ProvidersStatus,
    SendIn,
)
from aios_backend.deps import AppSettings
from aios_backend.runtime import GenerationsDep
from db.session import Db, DbSession

router = APIRouter(tags=["chat"])

# Server-Sent Events; Electron main reads them and forwards each one to the window over IPC.
STREAM_RESPONSES: dict[int | str, dict[str, object]] = {
    200: {
        "content": {"text/event-stream": {}},
        "description": "Events: started, phase, delta, done, error (see docs/local-api-plan.md)",
    }
}
SSE_HEADERS = {"Cache-Control": "no-store", "X-Accel-Buffering": "no"}


@router.get(
    "/projects/{project_id}/conversations", summary="Conversations of a project, newest first"
)
def list_conversations(project_id: str, session: DbSession) -> list[ConversationOut]:
    return service.list_conversations(session, project_id)


@router.post(
    "/projects/{project_id}/conversations",
    status_code=status.HTTP_201_CREATED,
    summary="Start a conversation",
)
def create_conversation(
    project_id: str, body: ConversationCreate, session: DbSession, settings: AppSettings
) -> ConversationOut:
    return service.create_conversation(session, settings, project_id, body.title)


@router.get("/conversations/{conversation_id}", summary="One conversation")
def get_conversation(conversation_id: str, session: DbSession) -> ConversationOut:
    return service.get_conversation(session, conversation_id)


@router.patch("/conversations/{conversation_id}", summary="Rename, archive or change model")
def update_conversation(
    conversation_id: str, body: ConversationPatch, session: DbSession
) -> ConversationOut:
    return service.update_conversation(
        session, conversation_id, body.title, body.archived, body.model_id
    )


@router.delete(
    "/conversations/{conversation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a conversation and its messages",
)
def delete_conversation(conversation_id: str, session: DbSession) -> None:
    service.delete_conversation(session, conversation_id)


@router.post(
    "/conversations/{conversation_id}/provider",
    summary="Move between Local and Company (Company needs confirmation)",
)
def change_provider(
    conversation_id: str, body: ProviderChange, session: DbSession, settings: AppSettings
) -> ConversationOut:
    return service.change_provider(session, settings, conversation_id, body.to, body.confirmed)


@router.get("/conversations/{conversation_id}/messages", summary="Messages in order")
def list_messages(conversation_id: str, session: DbSession) -> list[MessageOut]:
    return service.list_messages(session, conversation_id)


@router.post(
    "/conversations/{conversation_id}/messages", summary="Send a message and get the answer"
)
def send(
    conversation_id: str,
    body: SendIn,
    session: DbSession,
    settings: AppSettings,
    answers: Answers,
    generations: GenerationsDep,
) -> Exchange:
    return service.send(session, settings, answers, generations, conversation_id, body.text)


@router.post(
    "/conversations/{conversation_id}/messages/stream",
    summary="Send a message; the answer streams as Server-Sent Events",
    response_class=StreamingResponse,
    responses=STREAM_RESPONSES,
)
def send_stream(
    conversation_id: str,
    body: SendIn,
    db: Db,
    settings: AppSettings,
    answers: Answers,
    generations: GenerationsDep,
) -> StreamingResponse:
    frames = service.stream_send(db, settings, answers, generations, conversation_id, body.text)
    return StreamingResponse(frames, media_type="text/event-stream", headers=SSE_HEADERS)


@router.post(
    "/conversations/{conversation_id}/regenerate", summary="Answer the last question again"
)
def regenerate(
    conversation_id: str,
    session: DbSession,
    settings: AppSettings,
    answers: Answers,
    generations: GenerationsDep,
) -> Exchange:
    return service.regenerate(session, settings, answers, generations, conversation_id)


@router.post(
    "/conversations/{conversation_id}/regenerate/stream",
    summary="Answer the last question again, streamed as Server-Sent Events",
    response_class=StreamingResponse,
    responses=STREAM_RESPONSES,
)
def regenerate_stream(
    conversation_id: str,
    db: Db,
    settings: AppSettings,
    answers: Answers,
    generations: GenerationsDep,
) -> StreamingResponse:
    frames = service.stream_regenerate(db, settings, answers, generations, conversation_id)
    return StreamingResponse(frames, media_type="text/event-stream", headers=SSE_HEADERS)


@router.post(
    "/conversations/{conversation_id}/stop",
    summary="Stop the answer being generated; the words so far are kept",
)
def stop(conversation_id: str, generations: GenerationsDep) -> MessageOut:
    return service.stop(generations, conversation_id)


@router.get(
    "/conversations/{conversation_id}/generation", summary="Whether an answer is being generated"
)
def generation(
    conversation_id: str, session: DbSession, generations: GenerationsDep
) -> GenerationOut:
    return service.generation_state(session, generations, conversation_id)


@router.post(
    "/conversations/{conversation_id}/continue-locally",
    summary="Move to Local and continue an interrupted answer or send the pending message",
)
def continue_locally(
    conversation_id: str,
    body: ContinueIn,
    session: DbSession,
    settings: AppSettings,
    answers: Answers,
    generations: GenerationsDep,
) -> ContinueOut:
    return service.continue_locally(
        session,
        settings,
        answers,
        generations,
        conversation_id,
        body.partial_message_id,
        body.text,
    )


@router.get("/providers/status", summary="Whether Local and Company can answer now")
def providers_status(
    session: DbSession, settings: AppSettings, answers: Answers
) -> ProvidersStatus:
    return service.providers_status(session, settings, answers)
