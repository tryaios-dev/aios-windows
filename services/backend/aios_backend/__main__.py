"""backend.exe entry point (the shipped app). Developers use ``aios-backend serve`` instead.

1. Read the launch handshake from stdin (token never in argv/env). A bad frame exits with
   code 2 before any database is opened, and no READY line is printed.
2. Load the desktop profile (forced: the environment cannot switch it), set up logging.
3. Back up chats.db and run migrations; restore the backup if one fails.
4. Bind 127.0.0.1 (port 0 = the OS picks one) and serve the API.
5. Print one READY line with the bound port once the server accepts requests.
"""

import asyncio
import json
import socket
import sys
from collections.abc import Callable

import uvicorn

from aios_backend.config import Profile, Settings, load
from aios_backend.main import configure_logging, create_app
from aios_common.handshake import HandshakeError, read_handshake
from db import migrate
from db.session import Database

EXIT_BAD_HANDSHAKE = 2


def bind_loopback(port: int) -> socket.socket:
    """Bind before announcing the port: nothing else can take it in between."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):  # Windows: no other socket may share the port
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
    sock.bind(("127.0.0.1", port))
    sock.listen(128)
    return sock


def print_ready(port: int) -> None:
    sys.stdout.write("READY " + json.dumps({"api_port": port}) + "\n")
    sys.stdout.flush()


async def serve(
    settings: Settings,
    db: Database,
    port: int,
    on_ready: Callable[[int], None] = print_ready,
) -> None:
    sock = bind_loopback(port)
    server = uvicorn.Server(
        uvicorn.Config(
            create_app(settings, db), host="127.0.0.1", log_config=None, access_log=False
        )
    )
    task = asyncio.create_task(server.serve(sockets=[sock]))
    while not server.started:
        if task.done():  # start-up failed: no READY line
            await task
            return
        await asyncio.sleep(0.01)
    on_ready(sock.getsockname()[1])
    await task


def main() -> None:
    try:
        hs = read_handshake()
    except HandshakeError as exc:
        sys.stderr.write(f"backend: handshake rejected: {exc}\n")
        sys.exit(EXIT_BAD_HANDSHAKE)
    settings = load(Profile.DESKTOP)
    configure_logging(settings)
    db = Database(settings)
    migrate.upgrade(db)  # synchronous, before the event loop starts
    asyncio.run(serve(settings, db, hs.api_port))


if __name__ == "__main__":
    main()
