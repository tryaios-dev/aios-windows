"""chats.db access for linked resources."""

from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import column, func, select, table
from sqlalchemy.orm import Session

from db.base import UTCDateTime
from db.models import LinkedModelPrice, LinkedResource, Message


def all_linked(session: Session) -> Sequence[LinkedResource]:
    return session.scalars(select(LinkedResource).order_by(LinkedResource.created_at)).all()


def get(session: Session, resource_id: str) -> LinkedResource | None:
    return session.get(LinkedResource, resource_id)


def add(session: Session, row: LinkedResource) -> None:
    session.add(row)
    session.flush()


def delete(session: Session, row: LinkedResource) -> None:
    session.delete(row)
    session.flush()


def usage(session: Session, model_id: str, since: datetime | None = None) -> tuple[int, int, int]:
    """(tokens read, tokens written, answers) of a linked resource's model, since ``since``
    (None: ever). The counts are the provider's own when it reported them."""
    query = select(
        func.coalesce(func.sum(Message.prompt_tokens), 0),
        func.coalesce(func.sum(Message.completion_tokens), 0),
        func.count(),
    ).where(
        Message.provider == "resource",
        Message.model_id == model_id,
        Message.role == "assistant",
    )
    if since is not None:
        query = query.where(Message.created_at >= since)
    tokens_in, tokens_out, answers = session.execute(query).one()
    return int(tokens_in), int(tokens_out), int(answers)


# The Images & video tab's table, read here only to count what a linked video resource made
# (the media app owns it; the apps do not import each other).
_media_items = table(
    "media_items", column("model"), column("status"), column("finished_at", UTCDateTime)
)


def videos_made(session: Session, resource_id: str, since: datetime | None = None) -> int:
    """Finished videos of a linked video resource since ``since`` (None: ever)."""
    query = (
        select(func.count())
        .select_from(_media_items)
        .where(_media_items.c.model == resource_id, _media_items.c.status == "done")
    )
    if since is not None:
        query = query.where(_media_items.c.finished_at >= since)
    return int(session.scalar(query) or 0)


def model_prices(
    session: Session, model_ids: list[str]
) -> dict[str, tuple[float | None, float | None]]:
    rows = session.scalars(
        select(LinkedModelPrice).where(LinkedModelPrice.model_id.in_(model_ids))
    ).all()
    return {r.model_id: (r.price_in, r.price_out) for r in rows}


def set_model_price(
    session: Session,
    resource_id: str,
    model_id: str,
    price_in: float | None,
    price_out: float | None,
) -> None:
    """Set one model's price; both None removes it (the resource's price applies again)."""
    row = session.get(LinkedModelPrice, model_id)
    if price_in is None and price_out is None:
        if row is not None:
            session.delete(row)
    elif row is None:
        session.add(
            LinkedModelPrice(
                model_id=model_id, resource_id=resource_id, price_in=price_in, price_out=price_out
            )
        )
    else:
        row.resource_id, row.price_in, row.price_out = resource_id, price_in, price_out
    session.flush()
