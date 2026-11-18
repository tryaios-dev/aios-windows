"""Content-free structured logging (SR-07, M-21).

Only whitelisted keys are emitted. Message text, prompts, secrets and recovery material
can never reach a log line because unknown keys are dropped.
"""

import json
import logging
import re
from pathlib import Path

ALLOWED_KEYS = frozenset(
    {
        "event",
        "component",
        "duration_ms",
        "status",
        "error_code",
        "conversation_id",
        "project_id",
        "model_id",
        "provider",
        "tokens_in",
        "tokens_out",
        "port",
        "count",
        "epoch",
        "seq",
    }
)
# An event is a short name, never a sentence: a message built with an f-string could carry content.
_EVENT_NAME = re.compile(r"[a-z][a-z0-9_.]{0,63}")
NUMBER_KEYS = frozenset({"duration_ms", "tokens_in", "tokens_out", "port", "count", "epoch", "seq"})


def _safe_event(msg: object) -> str:
    return msg if isinstance(msg, str) and _EVENT_NAME.fullmatch(msg) else "unnamed"


def _safe_value(key: str, value: object) -> object:
    if key in NUMBER_KEYS:
        return value if isinstance(value, int) and not isinstance(value, bool) else None
    return value


class ContentFreeFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        fields = getattr(record, "fields", {}) or {}
        safe = {k: _safe_value(k, v) for k, v in fields.items() if k in ALLOWED_KEYS}
        return json.dumps(
            {
                "ts": self.formatTime(record),
                "level": record.levelname,
                "logger": record.name,
                "event": _safe_event(record.msg),
                **safe,
            },
            separators=(",", ":"),
        )


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(f"aios.{name}")


def log_event(logger: logging.Logger, event: str, **fields: object) -> None:
    logger.info(event, extra={"fields": fields})


# ------------------------------------------------------------------ retention (M-21, AC-20)
MAX_AGE_DAYS = 14
MAX_TOTAL_BYTES = 20 * 1024 * 1024
# Per-process rotation, sized so all of them together stay under MAX_TOTAL_BYTES:
# backend 4 MB x 3 files, evidence writer 1 MB x 2, Electron main 1 MB x 2 = 16 MB.
ROTATION = {"backend": (4 * 1024 * 1024, 2), "evidence-writer": (1024 * 1024, 1)}


def prune(folder: Path, now: float | None = None) -> None:
    """Keep the log folder within 14 days and 20 MB, whichever comes first (M-21).

    Log files older than 14 days are deleted; then the oldest files go until the folder holds at
    most 20 MB. Only ``*.log`` and rotated ``*.log.N`` files are touched.
    """
    import time

    if not folder.is_dir():
        return
    now = time.time() if now is None else now
    files = [
        p for p in folder.iterdir() if p.is_file() and (p.suffix == ".log" or ".log." in p.name)
    ]
    keep = []
    for path in files:
        try:
            if now - path.stat().st_mtime > MAX_AGE_DAYS * 86400:
                path.unlink()
            else:
                keep.append(path)
        except OSError:
            continue
    keep.sort(key=lambda p: p.stat().st_mtime)
    total = sum(p.stat().st_size for p in keep)
    for path in keep:
        if total <= MAX_TOTAL_BYTES:
            break
        try:
            size = path.stat().st_size
            path.unlink()
            total -= size
        except OSError:
            continue


def file_handler(path: Path, name: str) -> logging.Handler:
    """A content-free, rotating log file for one process, after pruning its folder."""
    from logging.handlers import RotatingFileHandler

    path.parent.mkdir(parents=True, exist_ok=True)
    prune(path.parent)
    max_bytes, backups = ROTATION[name]
    handler = RotatingFileHandler(path, maxBytes=max_bytes, backupCount=backups, encoding="utf-8")
    handler.setFormatter(ContentFreeFormatter())
    return handler
