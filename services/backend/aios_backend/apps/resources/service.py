"""Link and unlink cloud AI models (Resources page).

Linking checks the API key with the resource (``GET /models``) and stores it only in the OS key
store; nothing from a conversation is sent. Unlinking removes the key; conversations that were on
the resource answer ``resource_not_linked`` until the person moves them (moving back to Local
never asks).
"""

from collections.abc import Callable

from sqlalchemy.orm import Session

from aios_backend import linked_config as config
from aios_backend.apps.resources import repository as repo
from aios_backend.apps.resources.models import LinkedResource
from aios_backend.apps.resources.schemas import LinkedResourceOut
from aios_backend.errors import AppError, not_found
from aios_common.logging import get_logger, log_event

log = get_logger("resources")

#: Checks a key with the resource before it is stored (``aios_backend.linked.check``).
Check = Callable[[str, str], str | None]


def _out(session: Session, row: LinkedResource) -> LinkedResourceOut:
    found = config.RESOURCES[row.id]
    return LinkedResourceOut(
        id=row.id,
        name=config.NAMES.get(row.id, row.id),
        model_id=found.model_name,
        linked_at=row.created_at,
        monthly_limit=row.monthly_limit,
        spent=0.0,
        uses=repo.answers_by(session, found.model_name),
    )


def list_linked(session: Session) -> list[LinkedResourceOut]:
    """Linked resources whose key is still in the key store."""
    return [_out(session, r) for r in repo.all_linked(session) if config.stored_key(r.id)]


def link(
    session: Session,
    resource_id: str,
    api_key: str | None,
    monthly_limit: float | None,
    check: Check,
) -> LinkedResourceOut:
    """Link with the key an operator stored on this computer if there is one (the person only
    presses Link), else with the key the person copied."""
    if resource_id not in config.RESOURCES:
        raise not_found("resource")
    key = (config.provisioned_key(resource_id) or api_key or "").strip()
    if not key:
        raise AppError("resource_key_missing", 400)
    if not config.valid_key(key):
        raise AppError("resource_key_invalid", 400)
    problem = check(resource_id, key)
    if problem is not None:
        log_event(log, "resource_link_refused", error_code=problem)
        raise AppError(problem, 400 if problem == "resource_key_rejected" else 502)
    config.store_key(resource_id, key)
    row = repo.get(session, resource_id)
    if row is None:
        row = LinkedResource(id=resource_id)
        repo.add(session, row)
    row.monthly_limit = monthly_limit
    session.flush()
    log_event(log, "resource_linked")
    return _out(session, row)


def unlink(session: Session, resource_id: str) -> None:
    if resource_id not in config.RESOURCES:
        raise not_found("resource")
    config.remove_key(resource_id)
    row = repo.get(session, resource_id)
    if row is not None:
        repo.delete(session, row)
    log_event(log, "resource_unlinked")
