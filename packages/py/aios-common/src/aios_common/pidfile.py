"""Which process holds a data file, and which process started it (D-07).

A small JSON file next to the data file. The holder writes it once it has the file, and removes
it when it exits cleanly. After a crash the file stays behind, so the next owner can tell a
leftover holder (its starter is gone) from one that is still in use (its starter still runs).

A process is named by its pid and its start time together, so a reused pid never matches.
Only pids and times are stored: no paths, no content.
"""

import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path

#: Next to evidence.db, written by the evidence writer.
WRITER_PID_FILE = "evidence-writer.pid"


@dataclass(frozen=True)
class Holder:
    pid: int
    created: float
    parent_pid: int
    parent_created: float | None  # None: the starter was already gone


def write(path: Path, holder: Holder) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(asdict(holder)), encoding="utf-8")
    os.replace(tmp, path)


def read(path: Path) -> Holder | None:
    """The recorded holder, or None when there is no readable record."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        return Holder(
            pid=int(raw["pid"]),
            created=float(raw["created"]),
            parent_pid=int(raw["parent_pid"]),
            parent_created=None if raw["parent_created"] is None else float(raw["parent_created"]),
        )
    except (OSError, ValueError, KeyError, TypeError):
        return None


def remove(path: Path, pid: int) -> None:
    """Remove the record if it is still ``pid``'s (a newer holder's record is left alone)."""
    holder = read(path)
    if holder is not None and holder.pid == pid:
        try:
            path.unlink()
        except OSError:
            pass
