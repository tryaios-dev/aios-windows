"""Process manager (D-05): on-demand start, GPU/CPU choice and fallback, crash watch, idle
unload, shutdown. Contract rules IPC-30, IPC-33, IPC-50 to IPC-52; acceptance AC-09.

The engine here is a stand-in process (Python sleeping) so these run everywhere in seconds.
The real llama-server is covered by test_spike.py and test_engine_lifetime.py.
"""

import asyncio
import subprocess
import sys
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import pytest

from aios_backend.components import Components, ComponentState
from aios_backend.engine import Engine, EngineError, EngineManager, NoModel
from aios_backend.engine.job import ChildJob
from aios_backend.engine.launcher import EXE, parse_device_list


class FakeEngines:
    """start_fn/probe_fn stand-ins. ``fail`` lists builds whose start fails."""

    def __init__(self, gpus: list[str] | None = None, fail: set[str] | None = None) -> None:
        self.gpus = gpus or []
        self.fail = fail or set()
        self.started: list[str] = []
        self.probes = 0
        self.engines: list[Engine] = []

    def start(self, engine_dir: Path, model: Path, temp: Path, job: ChildJob, build: str) -> Engine:
        assert engine_dir.name == build
        self.started.append(build)
        if build in self.fail:
            raise EngineError("engine_exit_on_start")
        proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"])
        job.assign(proc)
        engine = Engine(proc, 0, "key", model, build)
        self.engines.append(engine)
        return engine

    def probe(self, engine_dir: Path, temp: Path) -> list[str]:
        self.probes += 1
        return self.gpus

    def cleanup(self) -> None:
        for e in self.engines:
            if e.alive():
                e.process.kill()
                e.process.wait()


def setup(
    tmp_path: Path,
    fakes: FakeEngines,
    *,
    model: bool = True,
    vulkan: bool = False,
    **kw: Any,
) -> tuple[EngineManager, Components]:
    root = tmp_path / "llama"
    for build in ("cpu", "vulkan") if vulkan else ("cpu",):
        (root / build).mkdir(parents=True)
        (root / build / EXE).write_bytes(b"")
    models = tmp_path / "models"
    models.mkdir()
    if model:
        (models / "Qwen3-4B-Q4_K_M.gguf").write_bytes(b"")
    c = Components()
    kw.setdefault("watch_interval_s", 0.05)
    m = EngineManager(
        root, models, tmp_path / "engine-tmp", c, start_fn=fakes.start, probe_fn=fakes.probe, **kw
    )
    return m, c


def run(fakes: FakeEngines, m: EngineManager, body: Callable[[], Awaitable[None]]) -> None:
    async def main() -> None:
        await m.startup()
        try:
            await body()
        finally:
            await m.shutdown()

    try:
        asyncio.run(main())
    finally:
        fakes.cleanup()


async def until(cond: Callable[[], bool], timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    while not cond():
        assert time.monotonic() < deadline, "condition not reached"
        await asyncio.sleep(0.02)


def test_ipc_30_engine_starts_only_when_needed(tmp_path: Path) -> None:
    fakes = FakeEngines()
    m, c = setup(tmp_path, fakes)

    async def body() -> None:
        await asyncio.sleep(0.2)
        assert fakes.started == [] and c.engine is ComponentState.NOT_STARTED
        async with m.use():
            assert c.engine is ComponentState.OK
            assert c.engine_build == "cpu"
            assert c.engine_model == "Qwen3-4B-Q4_K_M.gguf"
        await m.ensure()
        assert fakes.started == ["cpu"]  # already running: not started twice

    run(fakes, m, body)


def test_no_model_leaves_the_engine_stopped(tmp_path: Path) -> None:
    fakes = FakeEngines()
    m, c = setup(tmp_path, fakes, model=False)

    async def body() -> None:
        with pytest.raises(NoModel):
            await m.ensure()
        assert fakes.started == [] and c.engine is ComponentState.NOT_STARTED

    run(fakes, m, body)


def test_gpu_build_is_used_when_a_gpu_is_found(tmp_path: Path) -> None:
    fakes = FakeEngines(gpus=["Vulkan0"])
    m, c = setup(tmp_path, fakes, vulkan=True)

    async def body() -> None:
        await m.ensure()
        assert c.engine_build == "vulkan" and not c.engine_cpu_fallback

    run(fakes, m, body)


@pytest.mark.parametrize(("gpus", "vulkan_build"), [([], True), (["Vulkan0"], False)])
def test_cpu_build_without_a_gpu_or_without_the_gpu_build(
    tmp_path: Path, gpus: list[str], vulkan_build: bool
) -> None:
    fakes = FakeEngines(gpus=gpus)
    m, c = setup(tmp_path, fakes, vulkan=vulkan_build)

    async def body() -> None:
        await m.ensure()
        assert c.engine_build == "cpu" and not c.engine_cpu_fallback

    run(fakes, m, body)
    assert fakes.probes == (1 if vulkan_build else 0)  # no GPU build: nothing to probe


def test_safe_mode_forces_the_cpu_build(tmp_path: Path) -> None:
    fakes = FakeEngines(gpus=["Vulkan0"])
    m, c = setup(tmp_path, fakes, vulkan=True, safe_mode=True)

    async def body() -> None:
        await m.ensure()
        assert c.engine_build == "cpu" and fakes.probes == 0

    run(fakes, m, body)


def test_ac_09_gpu_build_that_fails_to_start_falls_back_to_cpu(tmp_path: Path) -> None:
    fakes = FakeEngines(gpus=["Vulkan0"], fail={"vulkan"})
    m, c = setup(tmp_path, fakes, vulkan=True)

    async def body() -> None:
        await m.ensure()
        assert fakes.started == ["vulkan", "cpu"]
        assert c.engine is ComponentState.OK and c.engine_build == "cpu"
        assert c.engine_cpu_fallback

    run(fakes, m, body)


def test_ac_09_gpu_crash_restarts_on_cpu_at_once(tmp_path: Path) -> None:
    fakes = FakeEngines(gpus=["Vulkan0"])
    m, c = setup(tmp_path, fakes, vulkan=True)

    async def body() -> None:
        gpu = await m.ensure()
        gpu.process.kill()  # forced GPU failure
        await until(lambda: c.engine_build == "cpu" and c.engine is ComponentState.OK)
        assert fakes.started == ["vulkan", "cpu"] and c.engine_cpu_fallback
        # The fallback holds for the session: the next start is CPU again.
        assert (await m.ensure()).build == "cpu"

    run(fakes, m, body)


def test_cpu_crash_is_reported_and_the_next_request_restarts(tmp_path: Path) -> None:
    fakes = FakeEngines()
    m, c = setup(tmp_path, fakes)

    async def body() -> None:
        first = await m.ensure()
        first.process.kill()
        await until(lambda: c.engine is ComponentState.FAILED)
        assert fakes.started == ["cpu"]  # no restart until something needs it
        second = await m.ensure()
        assert second is not first and second.alive() and c.engine is ComponentState.OK

    run(fakes, m, body)


def test_failed_cpu_start_is_reported(tmp_path: Path) -> None:
    fakes = FakeEngines(fail={"cpu"})
    m, c = setup(tmp_path, fakes)

    async def body() -> None:
        with pytest.raises(EngineError):
            await m.ensure()
        assert c.engine is ComponentState.FAILED

    run(fakes, m, body)


def test_idle_engine_is_unloaded_and_the_next_request_restarts_it(tmp_path: Path) -> None:
    fakes = FakeEngines()
    m, c = setup(tmp_path, fakes, idle_unload_s=0.3)

    async def body() -> None:
        async with m.use() as first:
            pass
        await until(lambda: not first.alive())
        assert c.engine is ComponentState.NOT_STARTED and c.engine_idle_unloaded
        assert c.engine_build is None and c.engine_model is None
        async with m.use() as second:
            assert second.alive() and c.engine is ComponentState.OK
            assert not c.engine_idle_unloaded

    run(fakes, m, body)


def test_engine_in_use_is_not_unloaded(tmp_path: Path) -> None:
    fakes = FakeEngines()
    m, c = setup(tmp_path, fakes, idle_unload_s=0.1)

    async def body() -> None:
        async with m.use() as engine:
            await asyncio.sleep(0.5)  # a long answer
            assert engine.alive() and c.engine is ComponentState.OK

    run(fakes, m, body)


def test_shutdown_stops_the_engine(tmp_path: Path) -> None:
    fakes = FakeEngines()
    m, c = setup(tmp_path, fakes)
    engines: list[Engine] = []

    async def body() -> None:
        engines.append(await m.ensure())

    run(fakes, m, body)
    assert not engines[0].alive() and c.engine is ComponentState.NOT_STARTED


def test_device_list_parsing() -> None:
    text = (
        "Available devices:\n"
        "  Vulkan0: NVIDIA GeForce RTX 3070 Ti Laptop GPU (8192 MiB, 7800 MiB free)\n"
        "  Vulkan1: Intel(R) UHD Graphics (4096 MiB, 4000 MiB free)\n"
    )
    assert parse_device_list(text) == ["Vulkan0", "Vulkan1"]
    assert parse_device_list("Available devices:\n  (none)\n") == []
    assert parse_device_list("") == []


def test_d06_turning_safe_mode_on_stops_an_idle_gpu_engine(tmp_path: Path) -> None:
    fakes = FakeEngines(gpus=["Vulkan0"])
    m, c = setup(tmp_path, fakes, vulkan=True)

    async def body() -> None:
        gpu = await m.ensure()
        assert gpu.build == "vulkan"
        await m.set_safe_mode(True)
        assert not gpu.alive() and c.engine is ComponentState.NOT_STARTED
        assert (await m.ensure()).build == "cpu"
        assert fakes.started == ["vulkan", "cpu"]

    run(fakes, m, body)


def test_d06_safe_mode_waits_for_the_answer_in_progress(tmp_path: Path) -> None:
    fakes = FakeEngines(gpus=["Vulkan0"])
    m, c = setup(tmp_path, fakes, vulkan=True)

    async def body() -> None:
        async with m.use() as gpu:
            await m.set_safe_mode(True)
            await asyncio.sleep(0.2)
            assert gpu.alive()  # not cut off mid-answer
        await until(lambda: not gpu.alive())
        assert c.engine is ComponentState.NOT_STARTED

    run(fakes, m, body)


def test_d06_lost_gpu_is_true_only_for_a_dead_gpu_engine(tmp_path: Path) -> None:
    fakes = FakeEngines(gpus=["Vulkan0"])
    m, _ = setup(tmp_path, fakes, vulkan=True, watch_interval_s=60)

    async def body() -> None:
        gpu = await m.ensure()
        assert not await m.lost_gpu(gpu, wait_s=0.1)  # still running: a plain error
        gpu.process.kill()
        assert await m.lost_gpu(gpu)
        cpu = await m.ensure()  # the retry
        assert cpu.build == "cpu"
        cpu.process.kill()
        assert not await m.lost_gpu(cpu)  # a CPU crash is not retried

    run(fakes, m, body)
