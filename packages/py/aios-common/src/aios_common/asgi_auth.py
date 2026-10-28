"""Loopback guard and bearer-token check for every request (SR-08, M-12, M-19, AC-10).

``public_paths`` lists paths that skip the token check (dev profile only: /health, /docs).
The loopback check always applies.

Pure ASGI middleware: it runs before routing, so an unauthenticated caller learns nothing,
not even which paths exist.
"""

from collections.abc import Callable

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from aios_common.handshake import check_bearer

LOOPBACK = frozenset({"127.0.0.1", "::1"})


class LoopbackTokenMiddleware:
    """``expected()`` returns the token this server accepts; None means the launch token."""

    def __init__(
        self,
        app: ASGIApp,
        expected: Callable[[], bytes | None] = lambda: None,
        public_paths: frozenset[str] = frozenset(),
    ) -> None:
        self.app = app
        self.expected = expected
        self.public_paths = public_paths

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return

        client = scope.get("client")
        if not client or client[0] not in LOOPBACK:
            await JSONResponse({"error": "forbidden"}, status_code=403)(scope, receive, send)
            return

        if scope.get("path") in self.public_paths:
            await self.app(scope, receive, send)
            return

        header = dict(scope.get("headers") or []).get(b"authorization")
        if not check_bearer(header.decode("latin-1") if header else None, self.expected()):
            await JSONResponse({"error": "unauthorized"}, status_code=401)(scope, receive, send)
            return

        await self.app(scope, receive, send)
