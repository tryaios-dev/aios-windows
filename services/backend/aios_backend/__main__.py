"""backend.exe entry point (the shipped app). Developers use ``aios-backend serve`` instead.

1. Read the launch handshake from stdin (token never in argv/env). A bad frame exits with
   code 2 before any database is opened, and no READY line is printed.
2. Load the desktop profile (forced: the environment cannot switch it), set up logging.
3. Back up chats.db and run migrations; restore the backup if one fails.
4. Bind 127.0.0.1 (port 0 = the OS picks one) and serve the API.
5. Start evidence-writer.exe (IPC-40) and the pump that sends it the queued evidence.
   Print one READY line with the bound port once the server accepts requests.
6. Exit when the parent (Electron main) is gone, so a crashed app cannot leave the backend
   running (IPC-51). The engine dies with the backend through the Job Object (IPC-50).
"""

import asyncio
import json
import os
import socket
import sys
from collections.abc import Callable

import psutil
import uvicorn

from aios_backend.apps.chat.answers import AnswerSource
from aios_backend.config import Profile, Settings, load
from aios_backend.main import configure_logging, create_app
from aios_common.handshake import HandshakeError, read_handshake
from aios_common.logging import get_logger, log_event
from db import migrate
from db.session import Database

EXIT_BAD_HANDSHAKE = 2
EXIT_SCHEMA = 4  # chats.db is newer than this build, or its pre-migration copy failed
PARENT_CHECK_S = 1.0

log = get_logger("api")


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


async def watch_parent(parent: psutil.Process, server: uvicorn.Server) -> None:
    """IPC-51: shut down cleanly (engine stopped, database closed) once the parent is gone.
    ``is_running()`` also compares the start time, so a reused PID does not count."""
    while not server.should_exit:
        await asyncio.sleep(PARENT_CHECK_S)
        if not parent.is_running():
            log_event(log, "parent_gone")
            server.should_exit = True


async def serve(
    settings: Settings,
    db: Database,
    port: int,
    on_ready: Callable[[int], None] = print_ready,
    parent: psutil.Process | None = None,
    answers: AnswerSource | None = None,
    start_writer: bool = True,
) -> None:
    sock = bind_loopback(port)
    server = uvicorn.Server(
        uvicorn.Config(
            create_app(settings, db, answers, start_writer=start_writer),
            host="127.0.0.1",
            log_config=None,
            access_log=False,
        )
    )
    task = asyncio.create_task(server.serve(sockets=[sock]))
    while not server.started:
        if task.done():  # start-up failed: no READY line
            await task
            return
        await asyncio.sleep(0.01)
    on_ready(sock.getsockname()[1])
    if parent is not None:
        watcher = asyncio.create_task(watch_parent(parent, server))
    await task
    if parent is not None:
        watcher.cancel()


def main() -> None:
    try:
        hs = read_handshake()
    except HandshakeError as exc:
        sys.stderr.write(f"backend: handshake rejected: {exc}\n")
        sys.exit(EXIT_BAD_HANDSHAKE)
    settings = load(Profile.DESKTOP)
    configure_logging(settings)
    db = Database(settings)
    try:
        migrate.upgrade(db)  # synchronous, before the event loop starts
    except migrate.NewerSchema as exc:
        # An older build on a migrated database: never touch it (E-06). The rollback is the
        # previous installer plus the named pre-migration backup (C-04 rollback procedure).
        log_event(log, "schema_newer_than_build", error_code="schema_newer_than_build")
        name = exc.backup.name if exc.backup else "none"
        sys.stderr.write(f"backend: chats.db is newer than this build; backup: {name}\n")
        sys.exit(EXIT_SCHEMA)
    except migrate.BackupFailed as exc:
        log_event(log, "backup_failed", error_code=str(exc))
        sys.stderr.write("backend: the pre-migration backup failed; nothing was changed\n")
        sys.exit(EXIT_SCHEMA)
    asyncio.run(serve(settings, db, hs.api_port, parent=psutil.Process(os.getppid())))


if __name__ == "__main__":
    main()
