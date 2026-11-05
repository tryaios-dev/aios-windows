"""HTTP endpoints for conversations and messages (MVP 9.3). Thin: validate, call the service."""

from fastapi import APIRouter, status

from aios_backend.apps.chat import service
from aios_backend.apps.chat.answers import Answers
from aios_backend.apps.chat.schemas import (
    ConversationCreate,
    ConversationOut,
    ConversationPatch,
    Exchange,
    MessageOut,
    ProviderChange,
    ProvidersStatus,
    SendIn,
)
from aios_backend.deps import AppSettings
from db.session import DbSession

router = APIRouter(tags=["chat"])


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
) -> Exchange:
    return service.send(session, settings, answers, conversation_id, body.text)


@router.post(
    "/conversations/{conversation_id}/regenerate", summary="Answer the last question again"
)
def regenerate(
    conversation_id: str, session: DbSession, settings: AppSettings, answers: Answers
) -> Exchange:
    return service.regenerate(session, settings, answers, conversation_id)


@router.get("/providers/status", summary="Whether Local and Company can answer now")
def providers_status(
    session: DbSession, settings: AppSettings, answers: Answers
) -> ProvidersStatus:
    return service.providers_status(session, settings, answers)
