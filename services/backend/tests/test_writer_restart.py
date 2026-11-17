"""Crash recovery for the evidence writer (report 16 Nov: "a writer that exits after start is not
restarted yet").

The backend starts the writer again the next time it needs it. Nothing is lost while it is down:
events wait in the outbox (F-05) and the pump replays them in order once the new writer answers.
A writer that keeps exiting is not restarted in a loop.
"""

from typing import Any

import pytest

from aios_backend.evidence.client import WriterUnavailable
from aios_backend.evidence.process import (
    MAX_RESTARTS,
    SupervisedWriter,
    WriterProcess,
    WriterStartError,
)


class FakeProc:
    def __init__(self) -> None:
        self.code: int | None = None
        self.terminated = False

    def poll(self) -> int | None:
        return self.code

    def terminate(self) -> None:
        self.terminated = True
        self.code = 0

    def wait(self, timeout: float | None = None) -> int:
        return 0

    def kill(self) -> None:
        self.code = -9


class FakeClient:
    def __init__(self, n: int) -> None:
        self.n = n

    def status(self) -> dict[str, Any]:
        return {"writer": self.n}


class Starter:
    def __init__(self) -> None:
        self.started: list[FakeProc] = []
        self.fail = False

    def __call__(self) -> WriterProcess:
        if self.fail:
            raise WriterStartError("writer_start_timeout")
        proc = FakeProc()
        self.started.append(proc)
        return WriterProcess(proc, 1000 + len(self.started), FakeClient(len(self.started)))  # type: ignore[arg-type]


def test_a_running_writer_is_used_as_it_is() -> None:
    start = Starter()
    writer = SupervisedWriter(start)
    assert writer.status() == {"writer": 1}
    assert writer.status() == {"writer": 1}
    assert len(start.started) == 1


def test_a_writer_that_exited_is_started_again_on_the_next_call() -> None:
    start = Starter()
    writer = SupervisedWriter(start)
    start.started[0].code = 1  # crashed
    assert writer.status() == {"writer": 2}
    assert len(start.started) == 2


def test_a_writer_that_keeps_exiting_is_not_restarted_in_a_loop() -> None:
    start = Starter()
    writer = SupervisedWriter(start, now=lambda: 100.0)
    for _ in range(MAX_RESTARTS):
        start.started[-1].code = 1
        writer.status()
    start.started[-1].code = 1
    with pytest.raises(WriterUnavailable):
        writer.status()
    assert len(start.started) == MAX_RESTARTS + 1


def test_restarts_are_allowed_again_after_a_quiet_while() -> None:
    start = Starter()
    clock = [100.0]
    writer = SupervisedWriter(start, now=lambda: clock[0])
    for _ in range(MAX_RESTARTS):
        start.started[-1].code = 1
        writer.status()
    clock[0] += 3600
    start.started[-1].code = 1
    assert writer.status() == {"writer": MAX_RESTARTS + 2}


def test_a_failed_restart_is_reported_as_unavailable() -> None:
    start = Starter()
    writer = SupervisedWriter(start)
    start.started[0].code = 1
    start.fail = True
    with pytest.raises(WriterUnavailable):
        writer.status()
    start.fail = False
    assert writer.status() == {"writer": 2}  # the next call tries again


def test_stop_ends_the_current_writer() -> None:
    start = Starter()
    writer = SupervisedWriter(start)
    writer.stop()
    assert start.started[0].terminated
