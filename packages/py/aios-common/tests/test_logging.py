import logging

from aios_common.logging import ContentFreeFormatter


def test_unknown_fields_are_dropped() -> None:
    rec = logging.LogRecord("x", logging.INFO, __file__, 1, "chat.saved", None, None)
    rec.fields = {"content": "secret prompt", "duration_ms": 12}
    out = ContentFreeFormatter().format(rec)
    assert "secret prompt" not in out
    assert '"duration_ms":12' in out
