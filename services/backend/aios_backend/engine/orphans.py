"""Orphan clean-up at start-up (Process and IPC Contract v1, IPC-52; MVP 11.1 step 5).

The Job Object (IPC-50) already kills the engine with the backend. This catches whatever
still slipped through: a crash in the moment between starting llama-server and adding it to
the job, or an engine started by an older version. An orphan is a llama-server whose program
file lies under this installation's engine folder and whose parent process is gone. An engine
whose parent still runs belongs to someone else (a developer's second backend, a benchmark)
and is left alone; the desktop app itself runs once per user (Electron single-instance lock).
"""

import sys
from collections.abc import Iterable
from pathlib import Path

import psutil

from aios_backend.engine.launcher import EXE
from aios_common.logging import get_logger, log_event

log = get_logger("engine")


def _is_under(path: str, root: Path) -> bool:
    try:
        return Path(path).resolve().is_relative_to(root.resolve())
    except (OSError, ValueError):
        return False


def is_orphan(proc: psutil.Process, engine_root: Path) -> bool:
    try:
        if proc.name().lower() != EXE.lower() or not _is_under(proc.exe(), engine_root):
            return False
        # parent() is None when the parent has exited (psutil also rejects a reused PID whose
        # process is younger than this one). Outside Windows an orphan is re-parented to init.
        parent = proc.parent()
        return parent is None or (sys.platform != "win32" and parent.pid == 1)
    except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
        return False


def kill_orphans(
    engine_root: Path, procs: Iterable[psutil.Process] | None = None, timeout: float = 10.0
) -> int:
    """End orphaned engines under ``engine_root``. Returns how many were found."""
    orphans = [
        p
        for p in (procs if procs is not None else psutil.process_iter())
        if is_orphan(p, engine_root)
    ]
    for p in orphans:
        try:
            p.kill()
        except psutil.NoSuchProcess:
            pass
    psutil.wait_procs(orphans, timeout=timeout)
    if orphans:
        log_event(log, "engine_orphans_killed", status=len(orphans))
    return len(orphans)
