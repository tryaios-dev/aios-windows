"""backend.exe entry point (the shipped app). Developers use ``aios-backend serve`` instead.

1. Read the launch handshake from stdin (token never in argv/env).
2. Load the desktop profile (forced: the environment cannot switch it), set up logging.
3. Back up chats.db and run migrations; restore the backup if one fails.
4. Serve the API on 127.0.0.1.
5. Print one READY line with the port for the Electron main process.
"""

import asyncio
import json
import socket
import sys

import uvicorn

from aios_backend.config import Profile, Settings, load
from aios_backend.main import configure_logging, create_app
from aios_common.handshake import read_handshake
from db import migrate
from db.session import Database


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


async def serve(settings: Settings, db: Database, port: int) -> None:
    server = uvicorn.Server(
        uvicorn.Config(
            create_app(settings, db), host="127.0.0.1", port=port, log_config=None, access_log=False
        )
    )
    sys.stdout.write("READY " + json.dumps({"api_port": port}) + "\n")
    sys.stdout.flush()
    await server.serve()


def main() -> None:
    hs = read_handshake()
    settings = load(Profile.DESKTOP)
    configure_logging(settings)
    db = Database(settings)
    migrate.upgrade(db)  # synchronous, before the event loop starts
    asyncio.run(serve(settings, db, hs.api_port or free_port()))


if __name__ == "__main__":
    main()
