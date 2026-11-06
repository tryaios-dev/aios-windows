"""The seam to the AIOS model mirror (an allowlisted host), like chat/answers.py.

``create_app`` puts a ``ModelMirror`` on ``app.state.mirror``. Today that is ``None``: the mirror
host is a placeholder until B-06, so downloads and the catalogue check answer
``503 mirror_unavailable``. Tests plug in a fake. A real mirror client lives outside the app
packages (network code never sits in a router).
"""

from collections.abc import Iterator
from typing import Annotated, Protocol

from fastapi import Depends, Request


class ModelMirror(Protocol):
    def fetch(self, entry_id: str, url: str, offset: int) -> Iterator[bytes]:
        """The model file from byte ``offset`` on, in chunks (HTTP range). Raises if unreachable."""
        ...

    def catalogue_version(self) -> str:
        """The version of the signed catalogue the mirror offers. Raises if unreachable."""
        ...


def get_mirror(request: Request) -> ModelMirror | None:
    mirror: ModelMirror | None = getattr(request.app.state, "mirror", None)
    return mirror


Mirror = Annotated[ModelMirror | None, Depends(get_mirror)]
