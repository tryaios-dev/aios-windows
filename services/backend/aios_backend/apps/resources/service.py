"""Link and unlink cloud AI models (Resources page).

Linking checks the API key with the resource (``GET /models``) and stores it only in the OS key
store; nothing from a conversation is sent. Unlinking removes the key; conversations that were on
the resource answer ``resource_not_linked`` until the person moves them (moving back to Local
never asks).
"""

import json
from collections.abc import Callable

from sqlalchemy.orm import Session

from aios_backend import linked_config as config
from aios_backend.apps.resources import repository as repo
from aios_backend.apps.resources.schemas import LinkedResourceOut, ResourceModelOut
from aios_backend.errors import AppError, not_found
from aios_common.logging import get_logger, log_event
from db.base import utcnow
from db.models import LinkedResource

log = get_logger("resources")

#: Checks a key with the resource before it is stored (``aios_backend.linked.check``).
Check = Callable[[str, str], str | None]
#: The chat models a key can use (``aios_backend.linked.chat_models``): a list or an error code.
ModelList = Callable[[str, str], list[str] | str]


def _remember(row: LinkedResource) -> None:
    """Offer the models the resource's key could use when it was linked."""
    try:
        found = json.loads(row.models) if row.models else None
    except ValueError:
        found = None
    ok = isinstance(found, list) and all(isinstance(m, str) for m in found)
    config.set_listed(row.id, found if ok else None)


def remember_models(session: Session) -> None:
    """At start-up: the model lists of every linked resource, for chat and the gateway."""
    for row in repo.all_linked(session):
        _remember(row)


def _out(session: Session, row: LinkedResource) -> LinkedResourceOut:
    if row.id in config.MEDIA:
        made = repo.videos_made(session, row.id, config.month_start(utcnow()))
        seconds = made * config.VIDEO_SECONDS.get(row.id, 0.0)
        return LinkedResourceOut(
            id=row.id,
            name=config.NAMES.get(row.id, row.id),
            model_id=row.id,
            kind="video",
            linked_at=row.created_at,
            monthly_limit=row.monthly_limit,
            spent=config.media_cost(seconds, row.price_in),
            uses=repo.videos_made(session, row.id),
            videos=made,
            video_seconds=round(seconds, 1),
            price_in=row.price_in,
        )
    since = config.month_start(utcnow())
    prices = repo.model_prices(session, config.model_ids(row.id))
    fallback = (row.price_in, row.price_out)
    models = []
    for mid in config.model_ids(row.id):
        m = config.Model(mid, config.model_name(row.id, mid))
        tokens_in, tokens_out, _ = repo.usage(session, m.id, since)
        price_in, price_out = prices.get(m.id, (None, None))
        own = price_in is not None or price_out is not None
        models.append(
            ResourceModelOut(
                id=m.id,
                name=m.name,
                tokens_in=tokens_in,
                tokens_out=tokens_out,
                uses=repo.usage(session, m.id)[2],
                price_in=price_in if own else row.price_in,
                price_out=price_out if own else row.price_out,
                spent=config.cost(
                    tokens_in, tokens_out, *((price_in, price_out) if own else fallback)
                ),
            )
        )
    return LinkedResourceOut(
        id=row.id,
        name=config.NAMES.get(row.id, row.id),
        model_id=models[0].id,
        linked_at=row.created_at,
        monthly_limit=row.monthly_limit,
        spent=sum(m.spent for m in models),
        uses=sum(m.uses for m in models),
        tokens_in=sum(m.tokens_in for m in models),
        tokens_out=sum(m.tokens_out for m in models),
        price_in=row.price_in,
        price_out=row.price_out,
        models=models,
    )


def set_price(
    session: Session,
    resource_id: str,
    per_million_in: float | None,
    per_million_out: float | None,
    model_id: str | None = None,
) -> None:
    """The company's price per million tokens for a linked resource, or for one of its models
    (``model_id``: Claude Opus and Claude Haiku cost differently), or for a video resource its
    price per second of video in ``per_million_in`` (operator: ``aios-backend resource price``).
    None clears it: a model is then charged at its resource's price, a resource counts only
    tokens (or seconds)."""
    row = repo.get(session, resource_id)
    if row is None:
        raise not_found("resource")
    if any(p is not None and not 0 <= p <= 10_000 for p in (per_million_in, per_million_out)):
        raise AppError("resource_price_invalid", 400)
    if model_id is not None:
        if model_id not in config.model_ids(resource_id):
            raise AppError("resource_model_unknown", 400)
        repo.set_model_price(session, resource_id, model_id, per_million_in, per_million_out)
        log_event(log, "resource_price_set")
        return
    row.price_in, row.price_out = per_million_in, per_million_out
    session.flush()
    log_event(log, "resource_price_set")


def list_linked(session: Session) -> list[LinkedResourceOut]:
    """Linked resources whose key is still in the key store."""
    rows = [r for r in repo.all_linked(session) if config.stored_key(r.id)]
    for row in rows:
        _remember(row)
    return [_out(session, r) for r in rows]


def link(
    session: Session,
    resource_id: str,
    api_key: str | None,
    monthly_limit: float | None,
    check: Check,
    models: ModelList | None = None,
) -> LinkedResourceOut:
    """Link with the key an operator stored on this computer if there is one (the person only
    presses Link), else with the key the person copied."""
    if not config.linkable(resource_id):
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
    # Every chat model this key can use is offered (checked again at each link).
    found = models(resource_id, key) if models is not None and resource_id in config.SPECS else None
    config.store_key(resource_id, key)
    row = repo.get(session, resource_id)
    if row is None:
        row = LinkedResource(id=resource_id)
        repo.add(session, row)
    row.monthly_limit = monthly_limit
    if isinstance(found, list) and found:
        row.models = json.dumps(found)
    _remember(row)
    session.flush()
    log_event(log, "resource_linked")
    return _out(session, row)


def unlink(session: Session, resource_id: str) -> None:
    if not config.linkable(resource_id):
        raise not_found("resource")
    config.remove_key(resource_id)
    row = repo.get(session, resource_id)
    if row is not None:
        repo.delete(session, row)
    log_event(log, "resource_unlinked")
