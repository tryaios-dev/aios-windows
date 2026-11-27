"""How the resources app checks a key with a resource: the HTTP client lives outside the apps
(``aios_backend.linked``) and is handed in by ``main.create_app`` (tests hand in their own)."""

from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, Request

from aios_backend.errors import AppError

Check = Callable[[str, str], str | None]


def get_check(request: Request) -> Check:
    check: Check | None = getattr(request.app.state, "resource_check", None)
    if check is None:
        raise AppError("resource_unreachable", 503)
    return check


KeyCheck = Annotated[Check, Depends(get_check)]

#: The chat models a key can use (``aios_backend.linked.chat_models``): a list, or an error code.
ModelList = Callable[[str, str], list[str] | str]


def get_model_list(request: Request) -> ModelList | None:
    """None (tests): the resource's own models are offered."""
    found: ModelList | None = getattr(request.app.state, "resource_models", None)
    return found


Models = Annotated[ModelList | None, Depends(get_model_list)]
