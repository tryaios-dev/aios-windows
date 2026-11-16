"""Add skills to my AI: list, add, switch on or off, remove, and add one from a file.

A skill is an instruction the AI on this computer follows while the skill is on (chat reads the
enabled ones from ``db.models.Skill``). A skill file (``.aios-skill``) is JSON with the same
fields as a listed skill; it is checked and shown before it is added, and only its fields are
kept. Events record the skill's name, publisher, version and licence, never the instruction.
"""

import json
import re
from pathlib import Path

from sqlalchemy.orm import Session

from aios_backend.apps.skills import catalogue
from aios_backend.apps.skills import repository as repo
from aios_backend.apps.skills.schemas import (
    InstalledSkillOut,
    SkillEntryOut,
    SkillFileCheck,
    SkillsOut,
)
from aios_backend.errors import AppError, not_found
from db.models import Skill

SKILL_FILE_ENDING = ".aios-skill"
MAX_FILE_BYTES = 256 * 1024
OWN_PUBLISHER = "Added by you"
_ID = re.compile(r"[^a-z0-9]+")
# Longest text each field of a skill file may hold (the table's limits).
LIMITS = {"name": 120, "line": 300, "detail": 4000, "version": 32, "licence": 64, "example": 500}


def _entry_out(e: catalogue.Entry) -> SkillEntryOut:
    return SkillEntryOut(
        id=e.id,
        name=e.name,
        line=e.line,
        detail=e.detail,
        category=e.category,
        publisher=e.publisher,
        licence=e.licence or (catalogue.INCLUDED if e.included else catalogue.LICENCE),
        open_source=not e.included,
        size_bytes=e.size_bytes,
        version=e.version,
        uses=list(e.uses),
        example=e.example,
        included=e.included,
        available=e.available,
    )


def _row_out(s: Skill) -> SkillEntryOut:
    return SkillEntryOut(
        id=s.id,
        name=s.name,
        line=s.line,
        detail=s.detail,
        category=s.category,
        publisher=s.publisher,
        licence=s.licence,
        open_source=s.open_source,
        size_bytes=s.size_bytes,
        version=s.version,
        uses=json.loads(s.uses),
        example=s.example,
        own=s.own,
    )


def _installed_out(s: Skill) -> InstalledSkillOut:
    return InstalledSkillOut(id=s.id, installed_at=s.created_at, enabled=s.enabled)


def list_skills(session: Session) -> SkillsOut:
    rows = repo.all_skills(session)
    own = [_row_out(s) for s in rows if s.own]
    return SkillsOut(
        catalogue=[_entry_out(e) for e in catalogue.SKILLS] + own,
        installed=[_installed_out(s) for s in rows],
    )


def _record(session: Session, event: str, s: Skill) -> None:
    # Evidence holds no free text (SR-07): the skill's id and version; the UI shows its name.
    body: dict[str, str | int | bool | None] = {
        "skill_id": s.id[:64],
        "version": re.sub(r"[^A-Za-z0-9_.:+\-]", "", s.version)[:32],
        "own": s.own,
    }
    repo.record_event(session, event, actor="user", body=body)


def install(session: Session, skill_id: str) -> InstalledSkillOut:
    entry = catalogue.BY_ID.get(skill_id)
    if entry is None:
        raise not_found("skill")
    if entry.included:
        raise AppError("skill_included", 409)
    if not entry.available:
        raise AppError("skill_not_in_build", 409)
    if repo.get(session, skill_id) is not None:
        raise AppError("skill_added", 409)
    out = _entry_out(entry)
    skill = Skill(
        id=entry.id,
        name=entry.name,
        line=entry.line,
        detail=entry.detail,
        category=entry.category,
        publisher=out.publisher,
        licence=out.licence,
        open_source=out.open_source,
        size_bytes=entry.size_bytes,
        version=entry.version,
        uses=json.dumps(list(entry.uses)),
        example=entry.example,
        instruction=entry.instruction,
        own=False,
        enabled=True,
    )
    repo.add(session, skill)
    _record(session, "skill_installed", skill)
    return _installed_out(skill)


def _skill(session: Session, skill_id: str) -> Skill:
    skill = repo.get(session, skill_id)
    if skill is None:
        if skill_id in catalogue.BY_ID and catalogue.BY_ID[skill_id].included:
            raise AppError("skill_included", 409)
        raise not_found("skill")
    return skill


def set_enabled(session: Session, skill_id: str, enabled: bool) -> InstalledSkillOut:
    skill = _skill(session, skill_id)
    skill.enabled = enabled
    session.flush()
    return _installed_out(skill)


def remove(session: Session, skill_id: str) -> None:
    skill = _skill(session, skill_id)
    _record(session, "skill_removed", skill)
    repo.delete(session, skill)


# ------------------------------------------------------------------ a skill of your own
def _text(data: dict[str, object], key: str, required: bool = True) -> str:
    value = data.get(key)
    if value is None and not required:
        return ""
    if not isinstance(value, str) or not value.strip():
        raise AppError("skill_file_invalid", 422)
    value = value.strip()
    if len(value) > LIMITS.get(key, 20_000):
        raise AppError("skill_file_invalid", 422)
    return value


def _read_file(path_text: str) -> tuple[Skill, str]:
    """The skill a file describes (not added yet), and the file's name."""
    path = Path(path_text)
    if not path.is_absolute() or not path.is_file():
        raise AppError("invalid_path", 400)
    if path.suffix.lower() != SKILL_FILE_ENDING:
        raise AppError("not_a_skill_file", 422)
    size = path.stat().st_size
    if size > MAX_FILE_BYTES:
        raise AppError("skill_file_invalid", 422)
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise AppError("skill_file_invalid", 422) from exc
    if not isinstance(data, dict):
        raise AppError("skill_file_invalid", 422)
    name = _text(data, "name")
    category = _text(data, "category")
    if category not in catalogue.CATEGORIES:
        category = "Documents"
    uses = data.get("uses") or [catalogue.CONVERSATION]
    if not isinstance(uses, list) or not all(isinstance(u, str) and u.strip() for u in uses):
        raise AppError("skill_file_invalid", 422)
    slug = _ID.sub("-", name.lower()).strip("-")[:50] or "skill"
    skill = Skill(
        id=f"own-{slug}",
        name=name,
        line=_text(data, "line"),
        detail=_text(data, "detail", required=False) or _text(data, "line"),
        category=category,
        publisher=OWN_PUBLISHER,
        licence=_text(data, "licence", required=False) or "Not stated",
        open_source=bool(data.get("open_source", False)),
        size_bytes=size,
        version=_text(data, "version", required=False) or "1.0",
        uses=json.dumps([u.strip()[:200] for u in uses][:10]),
        example=_text(data, "example", required=False),
        instruction=_text(data, "instruction"),
        own=True,
        enabled=True,
    )
    return skill, path.name


def check_file(session: Session, path_text: str) -> SkillFileCheck:
    skill, file_name = _read_file(path_text)
    return SkillFileCheck(
        entry=_row_out(skill),
        file_name=file_name,
        already_added=repo.get(session, skill.id) is not None,
    )


def install_file(session: Session, path_text: str) -> InstalledSkillOut:
    skill, _ = _read_file(path_text)
    if repo.get(session, skill.id) is not None or skill.id in catalogue.BY_ID:
        raise AppError("skill_added", 409)
    repo.add(session, skill)
    _record(session, "skill_installed", skill)
    return _installed_out(skill)
