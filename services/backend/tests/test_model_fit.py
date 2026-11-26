"""apps/models/fit.py: where a model fits, how fast it writes, and which one is suggested."""

import dataclasses

import pytest

from aios_backend.apps.models import catalogue, fit, hardware
from aios_backend.apps.models.engine import GpuDevice
from aios_backend.apps.models.models import HardwareProfile

GIB = 1024**3
GB = 10**9
SMALL = "minicpm5-2b-q4_k_m-openbmb-gguf"
MEDIUM = "ornith-1.5-9b-q4_k_m-ornith-gguf"
SAGE = "sage-a1.5-q4_k_m-mradermacher-gguf"
QWEN27 = "qwen3.8-27b-ud-q4_k_m-unsloth-gguf"


def machine(**kw: object) -> fit.Machine:
    base: dict[str, object] = {
        "ram_gb": 16,
        "usable_ram_bytes": 15 * GIB,
        "free_disk_gb": 500,
        "cores": 8,
        "memory_gbs": 50.0,
        "card_free_bytes": 0,
        "card_gbs": 400.0,
    }
    return fit.Machine(**{**base, **kw})  # type: ignore[arg-type]


def entry(entry_id: str, **kw: object) -> catalogue.Entry:
    found = catalogue.find(entry_id)
    assert found is not None
    return dataclasses.replace(found, **kw)  # type: ignore[arg-type]


def one(m: fit.Machine, e: catalogue.Entry, measured: fit.Measured | None = None) -> fit.Estimate:
    return next(x for x in fit.estimate(m, [e], measured) if x.entry.id == e.id)


# ------------------------------------------------------------------ budget and fit
def test_a_model_that_fits_the_card_runs_on_it_and_needs_no_system_memory() -> None:
    e = entry(MEDIUM)
    x = one(machine(card_free_bytes=8 * GIB, usable_ram_bytes=2 * GIB), e)
    assert x.runs_on == "card" and x.memory_bytes == 0


def test_the_card_keeps_the_1_gib_llama_server_keeps_free() -> None:
    e = entry(MEDIUM, context_bytes_per_token=0)
    need = e.size_bytes + fit.ENGINE_BUFFERS_BYTES
    assert one(machine(card_free_bytes=need + GIB), e).runs_on == "card"
    assert one(machine(card_free_bytes=need + GIB - 1), e).runs_on == "split"


def test_system_memory_is_what_windows_can_use_not_what_is_installed() -> None:
    e = entry(MEDIUM, context_bytes_per_token=0)
    need = e.size_bytes + fit.ENGINE_BUFFERS_BYTES + fit.SYSTEM_RESERVE_BYTES
    assert one(machine(ram_gb=64, usable_ram_bytes=need), e).runs_on == "processor"
    assert one(machine(ram_gb=64, usable_ram_bytes=need - 1), e).problem == "memory"


def test_built_in_graphics_count_as_system_memory() -> None:
    row = HardwareProfile(
        cpu="x", cores=8, ram_gb=32, gpu_name="Radeon", vram_gb=8, gpu_driver_ok=True,
        free_disk_gb=500, os="x", usable_ram_bytes=24 * GIB, card_free_bytes=8 * GIB,
        card_integrated=True,
    )  # fmt: skip
    assert hardware.machine(row).card_free_bytes == 0


def test_the_card_is_the_separate_one_with_most_free_memory() -> None:
    built_in = GpuDevice(16 * GIB, 15 * GIB, integrated=True)
    small, big = GpuDevice(4 * GIB, 3 * GIB, False), GpuDevice(8 * GIB, 7 * GIB, False)
    assert hardware.card([built_in, small, big]) == (7 * GIB, False)
    assert hardware.card([built_in]) == (15 * GIB, True)
    assert hardware.card([]) == (0, None)


def test_a_mixture_of_experts_model_moves_its_experts_to_system_memory_first() -> None:
    e = entry(SAGE)
    x = one(machine(card_free_bytes=8 * GIB, usable_ram_bytes=31 * GIB), e)
    dense = e.size_bytes - e.expert_bytes
    assert x.runs_on == "split"
    assert x.card_bytes > dense  # the rest of the model and some experts on the card
    assert x.memory_bytes < e.expert_bytes * e.expert_share_per_token


def test_a_model_without_room_on_the_drive_does_not_fit() -> None:
    e = entry(SMALL)
    disk_gb = (e.size_bytes + fit.WORKING_SPACE_BYTES) // GIB
    assert one(machine(free_disk_gb=disk_gb), e).problem == "disk"


# ------------------------------------------------------------------ speed
def test_writing_speed_is_bandwidth_over_bytes_read_per_word() -> None:
    e = entry(SMALL)
    x = one(machine(memory_gbs=100.0), e)
    assert x.tokens_per_second == pytest.approx(100 * GB * fit.PROCESSOR_EFFICIENCY / e.size_bytes)


def test_a_mixture_of_experts_model_reads_only_its_active_part() -> None:
    e = entry(SAGE)
    dense = e.size_bytes - e.expert_bytes
    x = one(machine(usable_ram_bytes=31 * GIB), e)
    assert x.memory_bytes == pytest.approx(dense + e.expert_bytes * e.expert_share_per_token)


def test_a_split_model_adds_the_time_on_the_card_and_in_system_memory() -> None:
    e = entry(MEDIUM)
    x = one(machine(card_free_bytes=4 * GIB), e)
    card = 400 * GB * fit.CARD_EFFICIENCY
    memory = 50 * GB * fit.PROCESSOR_EFFICIENCY
    assert x.runs_on == "split"
    assert 1 / x.tokens_per_second == pytest.approx(x.card_bytes / card + x.memory_bytes / memory)  # type: ignore[operator]


def test_a_speed_test_on_the_processor_predicts_the_other_processor_models() -> None:
    m = machine(usable_ram_bytes=31 * GIB)
    small, medium = entry(SMALL), entry(MEDIUM)
    found = fit.estimate(m, [small, medium], fit.Measured(SMALL, 27.0, "cpu"))
    tested, other = found
    assert tested.measured and tested.tokens_per_second == 27.0
    assert not other.measured
    assert other.tokens_per_second == pytest.approx(27.0 * small.size_bytes / medium.size_bytes)


def test_a_speed_test_does_not_carry_over_to_models_that_run_differently() -> None:
    m = machine(card_free_bytes=4 * GIB)
    small, medium = entry(SMALL), entry(MEDIUM)  # Light on the card, Standard split
    before = fit.estimate(m, [small, medium])
    after = fit.estimate(m, [small, medium], fit.Measured(MEDIUM, 3.0, "vulkan"))
    assert after == before  # a split model's test calibrates nothing
    on_cpu_build = fit.estimate(m, [small, medium], fit.Measured(SMALL, 50.0, "cpu"))
    assert on_cpu_build == before  # Light ran on the processor, but it would run on the card


def test_a_speed_test_that_read_a_prompt_sets_the_first_word_wait() -> None:
    m = machine(usable_ram_bytes=31 * GIB)
    small, medium = entry(SMALL), entry(MEDIUM)
    guessed = fit.estimate(m, [small, medium])
    found = fit.estimate(m, [small, medium], fit.Measured(SMALL, 27.0, "cpu", 200.0))
    tested, other = found
    assert tested.first_word_s == pytest.approx(fit.TYPICAL_PROMPT_TOKENS / 200.0)
    assert other.first_word_s == pytest.approx(  # reads more bytes per token, so slower
        fit.TYPICAL_PROMPT_TOKENS / (200.0 * small.size_bytes / medium.size_bytes)
    )
    assert other.first_word_s != guessed[1].first_word_s


def test_the_first_word_counts_physical_cores() -> None:
    row = HardwareProfile(
        cpu="x", cores=4, ram_gb=8, gpu_name=None, vram_gb=None, gpu_driver_ok=False,
        free_disk_gb=50, os="x", usable_ram_bytes=7 * GIB, physical_cores=4,
    )  # fmt: skip
    assert hardware.machine(row).cores == 4  # a VM: one thread per core
    row.physical_cores = None
    assert hardware.machine(row).cores == 2  # not known: two threads a core


def test_ac_04_the_first_word_waits_for_the_prompt_to_be_read() -> None:
    e = entry(MEDIUM)
    few, many = one(machine(cores=4), e), one(machine(cores=16), e)
    assert few.first_word_s > many.first_word_s  # type: ignore[operator]
    assert few.first_word_s > fit.FIRST_WORD_LIMIT_S and not few.fast_enough  # type: ignore[operator]


# ------------------------------------------------------------------ pick
def test_the_best_model_that_is_fast_enough_is_suggested() -> None:
    m = machine(card_free_bytes=23 * GIB, card_gbs=900.0)
    found = fit.pick(m, fit.estimate(m, catalogue.entries()), lambda e: True)
    assert found is not None and found.entry.id == QWEN27


def test_standard_is_not_suggested_on_the_processor_when_it_writes_too_slowly() -> None:
    m = machine(memory_gbs=50.0)  # DDR4-3200, two channels
    found = fit.estimate(m, [entry(SMALL), entry(MEDIUM)])
    assert found[1].tokens_per_second < fit.MIN_TOKENS_PER_SECOND  # type: ignore[operator]
    assert fit.pick(m, found, lambda e: True).entry.id == SMALL  # type: ignore[union-attr]


def test_when_nothing_is_fast_enough_the_fastest_that_fits_is_suggested() -> None:
    m = machine(memory_gbs=5.0, cores=2)
    found = fit.estimate(m, [entry(SMALL), entry(MEDIUM)])
    assert not any(x.fast_enough for x in found)
    assert fit.pick(m, found, lambda e: True).entry.id == SMALL  # type: ignore[union-attr]


def test_nothing_is_suggested_below_the_minimum() -> None:
    m = machine(ram_gb=7, usable_ram_bytes=7 * GIB)
    assert fit.pick(m, fit.estimate(m, catalogue.entries()), lambda e: True) is None


def test_an_installed_model_already_has_its_space_on_the_drive() -> None:
    e = entry(SMALL)
    m = machine(free_disk_gb=1)
    assert one(m, e).problem == "disk"
    assert fit.estimate(m, [e], installed=[SMALL])[0].runs_on == "processor"
