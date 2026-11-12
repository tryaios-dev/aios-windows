"""Request and response bodies for projects (shapes of Project, ExportResult, ImportResult in the UI)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Classification = Literal["restricted", "internal", "public"]


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    classification: Classification
    classification_source: Literal["project", "import", "review"]
    derived_from_project_id: str | None
    company_ai_enabled: bool
    archived: bool
    created_at: datetime
    updated_at: datetime


class ProjectCreate(BaseModel):
    name: str = Field(max_length=200)
    # Restricted unless the user picks Internal or Public at creation (M-04, AC-05).
    classification: Classification = "restricted"


class ProjectPatch(BaseModel):
    """Rename and/or archive. Classification changes go through /reclassify."""

    name: str | None = Field(default=None, max_length=200)
    archived: bool | None = None


class Reclassify(BaseModel):
    to: Classification


class ReclassifyOut(BaseModel):
    project: ProjectOut
    reviewed_copy: bool  # lowering creates a reviewed copy; the original is untouched (M-04)


class CompanyAi(BaseModel):
    enabled: bool
    confirmed: bool = False  # turning it on always needs an explicit confirmation


class ExportIn(BaseModel):
    """``path``: where Electron main's save dialog says to write the ``.aiosproj`` file."""

    path: str = Field(min_length=1, max_length=1024)
    confirmed: bool = False  # required for Restricted projects (spec P-1)


class ExportOut(BaseModel):
    file_name: str
    path: str
    size_bytes: int
    checksum: str
    package_id: str
    evidence_seq: int | None  # set once the evidence writer has appended the export event


class ImportIn(BaseModel):
    path: str = Field(min_length=1, max_length=1024)


class ImportOut(BaseModel):
    project_id: str
    project_name: str
    conversations: int
    messages: int
    summaries: int
    warnings: list[str]
    remapped: bool  # the name was taken, so " (imported)" was added


class PackageRecordOut(BaseModel):
    """One export or import of a Project Package (project settings, package history)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: str
    direction: Literal["export", "import"]
    package_id: str
    file_name: str
    size_bytes: int
    checksum: str
    conversations: int
    messages: int
    summaries: int
    created_at: datetime
