"""HTTP endpoints for My secure knowledge. Thin: validate, call the service."""

from fastapi import APIRouter, Response, status

from aios_backend.apps.knowledge import service
from aios_backend.apps.knowledge.schemas import (
    AddFilesIn,
    AddFolderIn,
    DocTextOut,
    FolderPreviewOut,
    KnowledgeDocOut,
)
from db.session import DbSession

router = APIRouter(tags=["knowledge"])


@router.get("/knowledge", summary="Documents in My secure knowledge, newest first")
def list_docs(session: DbSession) -> list[KnowledgeDocOut]:
    return service.list_docs(session)


@router.post("/knowledge", summary="Copy files in and read them; originals are never changed")
def add_files(body: AddFilesIn, session: DbSession) -> list[KnowledgeDocOut]:
    return service.add_files(session, body.paths, body.collection)


@router.post("/knowledge/folder/preview", summary="What adding a folder would copy; adds nothing")
def preview_folder(body: AddFolderIn, session: DbSession) -> FolderPreviewOut:
    return service.preview_folder(session, body.path)


@router.post("/knowledge/folder", summary="Copy the files of a folder in, as one collection")
def add_folder(body: AddFolderIn, session: DbSession) -> list[KnowledgeDocOut]:
    return service.add_folder(session, body.path)


@router.post("/knowledge/{doc_id}/retry", summary="Read a document again from its encrypted copy")
def retry(doc_id: str, session: DbSession) -> KnowledgeDocOut:
    return service.retry(session, doc_id)


@router.get("/knowledge/{doc_id}/text", summary="The text AIOS read from a document")
def doc_text(doc_id: str, session: DbSession) -> DocTextOut:
    return service.doc_text(session, doc_id)


@router.delete(
    "/knowledge/{doc_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove the encrypted copy; the original file is not touched",
)
def remove(doc_id: str, session: DbSession) -> Response:
    service.remove(session, doc_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
