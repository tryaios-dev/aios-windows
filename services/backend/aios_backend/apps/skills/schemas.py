"""Request and response bodies for Add skills to my AI (UI types SkillEntry, InstalledSkill)."""

from datetime import datetime

from pydantic import BaseModel, Field


class SkillEntryOut(BaseModel):
    id: str
    name: str
    line: str
    detail: str
    category: str
    publisher: str
    licence: str
    open_source: bool
    size_bytes: int
    version: str
    uses: list[str]
    example: str
    included: bool = False
    own: bool = False
    # False: listed, but it cannot be added in this build yet.
    available: bool = True


class InstalledSkillOut(BaseModel):
    id: str
    installed_at: datetime
    enabled: bool


class SkillsOut(BaseModel):
    """What can be added (and what was added from a file), and what the AI has now."""

    catalogue: list[SkillEntryOut]
    installed: list[InstalledSkillOut]


class EnabledIn(BaseModel):
    enabled: bool


class SkillFileIn(BaseModel):
    """A ``.aios-skill`` file chosen in the system file dialog."""

    path: str = Field(min_length=1, max_length=1024)


class SkillFileCheck(BaseModel):
    """What a skill file holds, shown before it is added. The check adds nothing."""

    entry: SkillEntryOut
    file_name: str
    already_added: bool
