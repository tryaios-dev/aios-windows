import logging

from aios_common.logging import ContentFreeFormatter


def test_unknown_fields_are_dropped() -> None:
    rec = logging.LogRecord("x", logging.INFO, __file__, 1, "chat.saved", None, None)
    rec.fields = {"content": "secret prompt", "duration_ms": 12}
    out = ContentFreeFormatter().format(rec)
    assert "secret prompt" not in out
    assert '"duration_ms":12' in out


def test_ac_20_an_event_name_with_text_in_it_is_not_logged() -> None:
    """An f-string log message could carry a prompt; only short names pass (SR-07, AC-20)."""
    rec = logging.LogRecord("x", logging.INFO, __file__, 1, "saved: my salary is 90k", None, None)
    out = ContentFreeFormatter().format(rec)
    assert "salary" not in out
    assert '"event":"unnamed"' in out


def test_ac_20_number_fields_only_carry_numbers() -> None:
    rec = logging.LogRecord("x", logging.INFO, __file__, 1, "evidence.appended", None, None)
    rec.fields = {"count": "the whole prompt", "epoch": 2}
    out = ContentFreeFormatter().format(rec)
    assert "prompt" not in out
    assert '"epoch":2' in out
    assert '"event":"evidence.appended"' in out


def test_ac_20_retention_keeps_14_days_and_20_mb(tmp_path) -> None:  # type: ignore[no-untyped-def]
    import os
    import time

    from aios_common.logging import MAX_TOTAL_BYTES, prune

    now = time.time()
    old = tmp_path / "backend.log.2"
    old.write_bytes(b"x")
    os.utime(old, (now - 15 * 86400, now - 15 * 86400))
    for i in range(5):  # 5 x 6 MB = 30 MB, newer files last
        path = tmp_path / f"backend.log.{i + 3}"
        path.write_bytes(b"y" * 6 * 1024 * 1024)
        os.utime(path, (now - (10 - i) * 60, now - (10 - i) * 60))
    other = tmp_path / "notes.txt"
    other.write_bytes(b"z")
    os.utime(other, (now - 30 * 86400, now - 30 * 86400))

    prune(tmp_path, now)
    left = sorted(p.name for p in tmp_path.iterdir())
    assert "backend.log.2" not in left  # older than 14 days
    assert "notes.txt" in left  # not a log file
    total = sum(p.stat().st_size for p in tmp_path.iterdir() if ".log" in p.name)
    assert total <= MAX_TOTAL_BYTES
    assert "backend.log.7" in left  # the newest is kept
