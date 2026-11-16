"""Request and response bodies for My secure knowledge (UI type KnowledgeDoc)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class KnowledgeDocOut(BaseModel):
    id: str
    name: str
    kind: str
    size_bytes: int
    pages: int | None
    collection: str
    origin: str
    added_at: datetime
    status: Literal["ready", "failed"]
    problem: str | None


class AddFilesIn(BaseModel):
    """Files chosen in the system file dialog (or dropped on the page), each an absolute path."""

    paths: list[str] = Field(min_length=1, max_length=500)
    collection: str | None = Field(default=None, min_length=1, max_length=260)


class AddFolderIn(BaseModel):
    """A folder chosen in the system folder dialog: its files are added as one collection."""

    path: str = Field(min_length=1, max_length=1024)


class DocTextOut(BaseModel):
    id: str
    text: str


class FolderFileOut(BaseModel):
    name: str
    size_bytes: int
    kind: str
    problem: str | None
    already: bool  # the same file is in My secure knowledge


class FolderPreviewOut(BaseModel):
    """What adding a folder would copy. Shown before anything is added; nothing is read yet."""

    name: str
    path: str
    files: list[FolderFileOut]
