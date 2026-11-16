"""My secure knowledge rules: copy files in, read them, list, retry, remove.

A file is copied into chats.db, which SQLCipher encrypts, and its text is read so a question can
be asked with it. The original is only read, never moved or changed. A file that cannot be read
stays in the list with the reason in plain words, so the person knows what happened. Events record
the kind and size only: no names, folders or content (SR-07).
"""

import uuid
from pathlib import Path

from sqlalchemy.orm import Session

from aios_backend.apps.knowledge import reader
from aios_backend.apps.knowledge import repository as repo
from aios_backend.apps.knowledge.schemas import (
    DocTextOut,
    FolderFileOut,
    FolderPreviewOut,
    KnowledgeDocOut,
)
from aios_backend.errors import AppError, not_found
from db.models import KnowledgeDoc

ONE_BY_ONE = "Added one by one"
# Files Windows, macOS and Office leave about that nobody means to add.
JUNK = {"desktop.ini", "thumbs.db", ".ds_store"}


def _out(doc: KnowledgeDoc) -> KnowledgeDocOut:
    return KnowledgeDocOut(
        id=doc.id,
        name=doc.name,
        kind=doc.kind,
        size_bytes=doc.size_bytes,
        pages=doc.pages,
        collection=doc.collection,
        origin=doc.origin,
        added_at=doc.created_at,
        status="ready" if doc.status == "ready" else "failed",
        problem=doc.problem,
    )


def _is_junk(path: Path) -> bool:
    name = path.name.lower()
    return name in JUNK or name.startswith(("~$", "._")) or name.startswith(".")


def _read_into(doc: KnowledgeDoc) -> None:
    try:
        result = reader.read(doc.name, doc.data)
    except reader.Unreadable as exc:
        doc.status, doc.problem, doc.text = "failed", exc.reason, ""
        return
    doc.status, doc.problem, doc.text, doc.pages = "ready", None, result.text, result.pages


def _add_one(session: Session, path: Path, collection: str) -> tuple[KnowledgeDoc, bool]:
    """The document, and whether it is new (the same file again keeps the one copy)."""
    size = path.stat().st_size
    same = repo.find_same(session, path.name, str(path.parent), size)
    if same is not None:
        return same, False
    if size > reader.MAX_BYTES:
        data, problem = b"", reader.TOO_LARGE
    else:
        data, problem = path.read_bytes(), None
    doc = KnowledgeDoc(
        id=str(uuid.uuid4()),
        name=path.name,
        kind=reader.kind_of(path.name),
        size_bytes=size,
        pages=None,
        collection=collection,
        origin=str(path.parent),
        status="failed",
        problem=problem,
        text="",
        data=data,
    )
    if problem is None:
        _read_into(doc)
    repo.add(session, doc)
    return doc, True


def _added(session: Session, results: list[tuple[KnowledgeDoc, bool]]) -> list[KnowledgeDocOut]:
    """One event for what one addition brought in: counts and size only, no names (SR-07)."""
    new = [d for d, fresh in results if fresh]
    if new:
        ready = [d for d in new if d.status == "ready"]
        repo.record_event(
            session,
            "knowledge_added",
            actor="user",
            body={
                "documents": len(ready),
                "could_not_read": len(new) - len(ready),
                "size_bytes": sum(d.size_bytes for d in new),
            },
        )
    return [_out(d) for d, _ in results]


def _checked(path_text: str) -> Path:
    path = Path(path_text)
    if not path.is_absolute() or not path.is_file():
        raise AppError("invalid_path", 400)
    return path


def list_docs(session: Session) -> list[KnowledgeDocOut]:
    return [_out(d) for d in repo.all_docs(session)]


def add_files(
    session: Session, paths: list[str], collection: str | None = None
) -> list[KnowledgeDocOut]:
    """Files chosen one by one (or dropped): checked first, so a bad path adds nothing."""
    checked = [_checked(p) for p in paths]
    return _added(
        session,
        [_add_one(session, p, collection or ONE_BY_ONE) for p in checked if not _is_junk(p)],
    )


def _folder_files(path_text: str) -> tuple[Path, list[Path]]:
    folder = Path(path_text)
    if not folder.is_absolute() or not folder.is_dir():
        raise AppError("invalid_path", 400)
    files = sorted(p for p in folder.rglob("*") if p.is_file() and not _is_junk(p))
    if len(files) > 500:
        raise AppError("too_many_files", 422)
    return folder, files


def preview_folder(session: Session, path_text: str) -> FolderPreviewOut:
    """What adding the folder would copy, and what is already here. Nothing is added or read."""
    folder, files = _folder_files(path_text)
    out = []
    for p in files:
        size = p.stat().st_size
        out.append(
            FolderFileOut(
                name=p.name,
                size_bytes=size,
                kind=reader.kind_of(p.name),
                problem=reader.reason_by_name(p.name, size),
                already=repo.find_same(session, p.name, str(p.parent), size) is not None,
            )
        )
    return FolderPreviewOut(name=folder.name, path=str(folder), files=out)


def add_folder(session: Session, path_text: str) -> list[KnowledgeDocOut]:
    """Every file in the folder and its subfolders, as one collection named after the folder."""
    folder, files = _folder_files(path_text)
    return _added(session, [_add_one(session, p, folder.name) for p in files])


def _doc(session: Session, doc_id: str) -> KnowledgeDoc:
    doc = repo.get(session, doc_id)
    if doc is None:
        raise not_found("document")
    return doc


def retry(session: Session, doc_id: str) -> KnowledgeDocOut:
    """Read again from the encrypted copy (a newer version of AIOS may read more kinds)."""
    doc = _doc(session, doc_id)
    if doc.data:
        _read_into(doc)
    session.flush()
    return _out(doc)


def doc_text(session: Session, doc_id: str) -> DocTextOut:
    doc = _doc(session, doc_id)
    return DocTextOut(id=doc.id, text=doc.text)


def remove(session: Session, doc_id: str) -> None:
    doc = _doc(session, doc_id)
    kind = doc.kind
    repo.delete(session, doc)
    repo.record_event(
        session, "knowledge_removed", actor="user", body={"doc_id": doc_id, "kind": kind}
    )
