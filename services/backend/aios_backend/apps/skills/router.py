"""HTTP endpoints for Add skills to my AI. Thin: validate, call the service."""

from fastapi import APIRouter, Request, Response, status

from aios_backend.apps.skills import service
from aios_backend.apps.skills.schemas import (
    EnabledIn,
    InstalledSkillOut,
    SkillFileCheck,
    SkillFileIn,
    SkillsOut,
)
from db.session import DbSession

router = APIRouter(tags=["skills"])


def _present(request: Request) -> service.Present:
    """What is on this computer that a listed skill may need (catalogue.Entry.needs)."""
    voice = getattr(request.app.state, "voice", None)
    return (
        frozenset({"voice_model"})
        if voice is not None and voice.model_path.is_file()
        else frozenset()
    )


@router.get("/skills", summary="The skills AIOS lists, and the ones the AI has")
def list_skills(request: Request, session: DbSession) -> SkillsOut:
    return service.list_skills(session, _present(request))


@router.post("/skills/file/check", summary="What a .aios-skill file holds; adds nothing")
def check_file(body: SkillFileIn, session: DbSession) -> SkillFileCheck:
    return service.check_file(session, body.path)


@router.post("/skills/file", summary="Add the skill in a .aios-skill file")
def install_file(body: SkillFileIn, session: DbSession) -> InstalledSkillOut:
    return service.install_file(session, body.path)


@router.post("/skills/{skill_id}", summary="Add a listed skill; it is on straight away")
def install(skill_id: str, request: Request, session: DbSession) -> InstalledSkillOut:
    return service.install(session, skill_id, _present(request))


@router.put("/skills/{skill_id}/enabled", summary="Turn an added skill on or off")
def set_enabled(skill_id: str, body: EnabledIn, session: DbSession) -> InstalledSkillOut:
    return service.set_enabled(session, skill_id, body.enabled)


@router.delete(
    "/skills/{skill_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove an added skill; conversations and documents are not touched",
)
def remove(skill_id: str, session: DbSession) -> Response:
    service.remove(session, skill_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
