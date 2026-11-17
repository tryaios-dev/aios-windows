"""End an evidence writer left behind by a crashed backend (D-07 scenario 2).

The Job Object (IPC-50) normally ends the writer with the backend, and the writer also exits
once it sees its parent is gone (within a second, signing a checkpoint on the way out). This
covers what slips through: a restart inside that second, a writer that hangs, or no job (CI,
development). The backend asks here before it starts a writer: a writer still in use means
``writer_locked`` at once, a leftover is ended first. (A second writer started against a held
file is not relied on: on Windows it can block for a long time instead of exiting with code 3.)

A leftover is the process named in the writer's record (pid and start time both match) whose
starter is gone. A writer whose starter still runs belongs to a live backend and is never
touched, so there is still exactly one writer. The record is the writer's (F-01); this module
only reads it.
"""

from pathlib import Path

import psutil

from aios_common import pidfile
from aios_common.logging import get_logger, log_event

#: Time a leftover gets to end itself (and sign its shutdown checkpoint) before it is killed.
GRACE_S = 3.0
_SAME_START_S = 0.01

log = get_logger("evidence")


def _live(pid: int, created: float | None) -> psutil.Process | None:
    if created is None:
        return None
    try:
        proc = psutil.Process(pid)
        if abs(proc.create_time() - created) < _SAME_START_S and proc.is_running():
            return proc
    except psutil.Error:
        pass
    return None


def _holder(folder: Path) -> tuple[psutil.Process | None, bool]:
    """(the running writer recorded in ``folder``, whether its starter still runs)."""
    holder = pidfile.read(folder / pidfile.WRITER_PID_FILE)
    if holder is None:
        return None, False
    proc = _live(holder.pid, holder.created)
    if proc is None:
        return None, False
    return proc, _live(holder.parent_pid, holder.parent_created) is not None


def in_use(folder: Path) -> bool:
    """A writer holds ``folder``'s evidence.db for a backend that still runs."""
    proc, starter_alive = _holder(folder)
    return proc is not None and starter_alive


def end_leftover_writer(folder: Path, timeout: float = 10.0) -> bool:
    """End the writer recorded in ``folder`` if its starter is gone. True if one was ended."""
    proc, starter_alive = _holder(folder)
    if proc is None or starter_alive:
        return False
    _, alive = psutil.wait_procs([proc], timeout=GRACE_S)
    killed = bool(alive)
    if killed:
        try:
            proc.kill()
        except psutil.NoSuchProcess:
            pass
        _, alive = psutil.wait_procs([proc], timeout=timeout)
        if alive:
            log_event(log, "writer_leftover_not_ended")
            return False
    log_event(log, "writer_leftover_ended", status="killed" if killed else "exited")
    return True
