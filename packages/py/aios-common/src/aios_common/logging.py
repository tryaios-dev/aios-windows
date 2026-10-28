"""Content-free structured logging (SR-07, M-21).

Only whitelisted keys are emitted. Message text, prompts, secrets and recovery material
can never reach a log line because unknown keys are dropped.
"""

import json
import logging

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
    }
)


class ContentFreeFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        fields = getattr(record, "fields", {}) or {}
        safe = {k: v for k, v in fields.items() if k in ALLOWED_KEYS}
        return json.dumps(
            {
                "ts": self.formatTime(record),
                "level": record.levelname,
                "logger": record.name,
                "event": record.msg if isinstance(record.msg, str) else "",
                **safe,
            },
            separators=(",", ":"),
        )


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(f"aios.{name}")


def log_event(logger: logging.Logger, event: str, **fields: object) -> None:
    logger.info(event, extra={"fields": fields})
