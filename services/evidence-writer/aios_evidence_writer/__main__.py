"""evidence-writer.exe entry point (IPC-40 to IPC-42, IPC-12 to IPC-16).

1. Read the handshake frame from stdin: the token is ``derive(T, evidence-writer)``. A bad frame
   exits with code 2 before evidence.db is opened, and no READY line is printed.
2. Open evidence.db with the exclusive lock. A second writer on the same file exits with code 3.
3. Bind 127.0.0.1 (port 0 = the OS picks one), serve, then print one READY line.
4. Exit when the parent (the backend) is gone; a checkpoint is signed on the way out.

``--data-dir`` is the folder that holds chats.db (the backend passes it; a path, not a secret).
The shipped executable always takes its signing key from the OS key store. From source,
``--profile dev`` uses the fixed, non-secret development seed instead.
"""

import argparse
import asyncio
import json
import logging
import os
import socket
import sys
from collections.abc import Callable
from pathlib import Path

import psutil
import uvicorn

from aios_common import paths
from aios_common.handshake import HandshakeError, read_handshake, token
from aios_common.logging import file_handler, get_logger, log_event
from aios_evidence_writer.app import create_app
from aios_evidence_writer.keys import KeySource, KeystoreKeys, MemoryKeys
from aios_evidence_writer.store import EvidenceStore, WriterError, WriterLocked

EXIT_BAD_HANDSHAKE = 2
EXIT_LOCKED = 3
PARENT_CHECK_S = 1.0

log = get_logger("evidence")


def bind_loopback(port: int) -> socket.socket:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
    sock.bind(("127.0.0.1", port))
    sock.listen(64)
    return sock


def print_ready(port: int) -> None:
    sys.stdout.write("READY " + json.dumps({"api_port": port}) + "\n")
    sys.stdout.flush()


async def watch_parent(parent: psutil.Process, server: uvicorn.Server) -> None:
    while not server.should_exit:
        await asyncio.sleep(PARENT_CHECK_S)
        if not parent.is_running():
            log_event(log, "parent_gone")
            server.should_exit = True


async def serve(
    store: EvidenceStore,
    expected_token: bytes,
    port: int,
    on_ready: Callable[[int], None] = print_ready,
    parent: psutil.Process | None = None,
) -> None:
    sock = bind_loopback(port)
    server = uvicorn.Server(
        uvicorn.Config(
            create_app(store, expected_token),
            host="127.0.0.1",
            log_config=None,
            access_log=False,
        )
    )
    task = asyncio.create_task(server.serve(sockets=[sock]))
    while not server.started:
        if task.done():
            await task
            return
        await asyncio.sleep(0.01)
    on_ready(sock.getsockname()[1])
    watcher = asyncio.create_task(watch_parent(parent, server)) if parent else None
    try:
        await task
    finally:
        if watcher:
            watcher.cancel()
        try:
            store.checkpoint()  # IPC-52: a shutdown checkpoint
        except WriterError:
            pass


def configure_logging(path: Path) -> None:
    """Content-free, rotating file in the shared logs folder (M-21); never stdout (READY only)."""
    handler = file_handler(path, "evidence-writer")
    for name in ("aios", "uvicorn.error"):
        logger = logging.getLogger(name)
        logger.handlers = [handler]
        logger.propagate = False
        logger.setLevel(logging.INFO if name == "aios" else logging.WARNING)
    logging.getLogger("uvicorn.access").disabled = True


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="evidence-writer")
    parser.add_argument("--profile", choices=["desktop", "dev"], default="desktop")
    parser.add_argument("--data-dir")
    parser.add_argument("--log-dir")  # the backend's log folder; no file log without it
    args = parser.parse_args(argv)
    if getattr(sys, "frozen", False):
        args.profile = "desktop"  # the shipped exe always signs with the OS key store

    try:
        hs = read_handshake()
    except HandshakeError as exc:
        sys.stderr.write(f"evidence-writer: handshake rejected: {exc}\n")
        sys.exit(EXIT_BAD_HANDSHAKE)

    folder = Path(args.data_dir) if args.data_dir else paths.data_dir() / "data"
    db_path = folder / "evidence.db"
    if args.log_dir:
        configure_logging(Path(args.log_dir) / "evidence-writer.log")
    keys: KeySource = KeystoreKeys() if args.profile == "desktop" else MemoryKeys()
    try:
        store = EvidenceStore(db_path, keys)
    except WriterLocked:
        sys.stderr.write("evidence-writer: another writer holds evidence.db\n")
        sys.exit(EXIT_LOCKED)
    asyncio.run(serve(store, token(), hs.api_port, parent=psutil.Process(os.getppid())))


if __name__ == "__main__":
    main()
