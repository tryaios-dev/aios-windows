"""backend.exe entry point (the shipped app). Developers use ``aios-backend serve`` instead.

1. Read the launch handshake from stdin (token never in argv/env). A bad frame exits with
   code 2 before any database is opened, and no READY line is printed.
2. Load the desktop profile (forced: the environment cannot switch it), set up logging.
3. Back up chats.db and run migrations; restore the backup if one fails.
4. Bind 127.0.0.1 (port 0 = the OS picks one) and serve the API.
5. Start evidence-writer.exe (IPC-40) and the pump that sends it the queued evidence.
   Start the local AI gateway on its own loopback port (G-01, IPC-02); chat reaches the model
   only through it. Print one READY line with both ports once the servers accept requests.
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
from aios_backend.company import ConfiguredCompany
from aios_backend.config import Profile, Settings, load
from aios_backend.gateway.app import create_gateway_app
from aios_backend.main import configure_logging, create_app
from aios_backend.providers import ProviderRouter
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


def print_ready(port: int, gateway_port: int | None = None) -> None:
    """The READY line (Process and IPC v1, section 4); ``gateway_port`` once the gateway runs."""
    payload: dict[str, int] = {"api_port": port}
    if gateway_port is not None:
        payload["gateway_port"] = gateway_port
    sys.stdout.write("READY " + json.dumps(payload) + "\n")
    sys.stdout.flush()


async def watch_parent(parent: psutil.Process, server: uvicorn.Server) -> None:
    """IPC-51: shut down cleanly (engine stopped, database closed) once the parent is gone.
    ``is_running()`` also compares the start time, so a reused PID does not count."""
    while not server.should_exit:
        await asyncio.sleep(PARENT_CHECK_S)
        if not parent.is_running():
            log_event(log, "parent_gone")
            server.should_exit = True


def _company_side(settings: Settings) -> ConfiguredCompany | None:
    """The Company provider (G-06). It follows company.json while running, so a server set up
    with ``aios-backend company set`` answers without restarting AIOS."""
    return ConfiguredCompany(settings.company_file) if settings.company_file else None


async def serve(
    settings: Settings,
    db: Database,
    port: int,
    on_ready: Callable[..., None] = print_ready,
    parent: psutil.Process | None = None,
    answers: AnswerSource | None = None,
    start_writer: bool = True,
    local: bool = True,
) -> None:
    """``local``: the installed model answers and models download from their origin. The
    end-to-end tests turn it off, so they never touch the network or need a model."""
    sock = bind_loopback(port)
    app = create_app(settings, db, answers, start_writer=start_writer, local=local)
    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", log_config=None, access_log=False)
    )
    task = asyncio.create_task(server.serve(sockets=[sock]))
    while not server.started:
        if task.done():  # start-up failed: no READY line
            await task
            return
        await asyncio.sleep(0.01)

    # G-01: the local model answers through the gateway, its own loopback endpoint inside this
    # process (IPC-02). Chat gets the provider router; only the router calls the gateway.
    gateway: uvicorn.Server | None = None
    gateway_task: asyncio.Task[None] | None = None
    gateway_port: int | None = None
    engine_side = app.state.answers
    company_side = _company_side(settings)
    if local and answers is None and engine_side is not None:
        gateway_sock = bind_loopback(0)
        gateway_port = gateway_sock.getsockname()[1]
        gateway = uvicorn.Server(
            uvicorn.Config(
                create_gateway_app(engine_side, company_side),
                host="127.0.0.1",
                log_config=None,
                access_log=False,
                lifespan="off",
            )
        )
        gateway_task = asyncio.create_task(gateway.serve(sockets=[gateway_sock]))
        while not gateway.started:
            if gateway_task.done():  # the gateway could not start: no READY line
                server.should_exit = True
                await task
                await gateway_task
                return
            await asyncio.sleep(0.01)
        app.state.answers = ProviderRouter(
            engine_side, f"http://127.0.0.1:{gateway_port}", company=company_side
        )

    if gateway_port is None:
        on_ready(sock.getsockname()[1])
    else:
        on_ready(sock.getsockname()[1], gateway_port)
    if parent is not None:
        watcher = asyncio.create_task(watch_parent(parent, server))
    await task
    if gateway is not None and gateway_task is not None:
        gateway.should_exit = True
        await gateway_task
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
