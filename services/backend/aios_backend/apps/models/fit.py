"""Where each model fits on this computer, how fast it writes, and the one AIOS suggests.

Pure logic, the same on every OS; the hardware comes from the platform layer and the engine's
``--list-devices`` (``hardware.py``). The app only shows what this returns.

1. Budget. Graphics card: the free memory llama-server reports, minus the 1 GiB it keeps free
   itself (``--fit``). Built-in graphics share system memory and count as no card. System
   memory: what Windows can use, minus room for Windows, other programs and AIOS. Installed
   memory is only for the 8 GB minimum.
2. Fit. Fully on the card; split (a mixture-of-experts model moves its experts to system
   memory first, any other model moves whole layers); only on the processor; or it does not
   fit. System memory is only needed for what is not on the card.
3. Speed. Writing reads the model's active weights once per word, so the time per token is
   bytes read on the card / card bandwidth + bytes read in system memory / memory bandwidth
   (the two parts run one after the other, so their times add up). After a speed test, the
   bandwidth it shows replaces the estimate for models that run the same way (fully on the
   card, or only on the processor). Reading the prompt is limited by computing: the first word
   comes after the prompt is read.
4. Pick. The best model that writes at least ``MIN_TOKENS_PER_SECOND`` (the app's "Slow"
   limit) and shows its first word within ``FIRST_WORD_LIMIT_S`` (AC-04). Better is the higher
   tier, then the model that does more work per word. If none is fast enough, the fastest one
   that fits.
"""

from collections.abc import Callable, Iterable
from dataclasses import dataclass, replace
from typing import Literal

from aios_backend.apps.models.catalogue import Entry
from aios_backend.engine.launcher import CONTEXT_TOKENS

GIB = 1024**3
GB = 10**9

MIN_RAM_GB, MIN_FREE_DISK_GB = 8, 10  # below either, nothing is suggested
WORKING_SPACE_BYTES = 2 * GIB  # free disk kept on top of the model file
CARD_MARGIN_BYTES = GIB  # llama-server --fit leaves this free on each device
SYSTEM_RESERVE_BYTES = 4 * GIB  # Windows, other programs and AIOS itself
ENGINE_BUFFERS_BYTES = GIB // 2  # the engine's working buffers next to the weights
DEFAULT_CONTEXT_BYTES_PER_TOKEN = 32 * 1024  # an entry that does not say

MIN_TOKENS_PER_SECOND = 8.0  # the app shows "Slow" below this (about 6 words a second)
FIRST_WORD_LIMIT_S = 10.0  # AC-04
# AC-04 times "a short answer": what the engine has not read yet when a question arrives. The
# system prompt with the chat template (about 50 tokens), a short question (about 20) and the
# earlier turns of a short conversation (about 80). The engine keeps what it already read, so
# later questions wait less; a long document excerpt waits longer, as the app already says.
TYPICAL_PROMPT_TOKENS = 150

# Share of the peak bandwidth the engine reaches when writing.
PROCESSOR_EFFICIENCY = 0.5
CARD_EFFICIENCY = 0.7
# When the hardware does not say: DDR4-3200 with two channels; a mid-range graphics card.
DEFAULT_MEMORY_GBS = 51.2
DEFAULT_CARD_GBS = 200.0
# Reading the prompt: bytes of weights processed a second, per physical processor core (Light
# read about 44 tokens a second on 4 cores of an i9-12900H, llama-server, CPU only) and on a
# graphics card. Used until a speed test measures this computer's own reading speed.
PROCESSOR_READ_BYTES_PER_CORE = 17 * GB
CARD_READ_BYTES = 4000 * GB

RunsOn = Literal["card", "split", "processor"]
Problem = Literal["disk", "memory"]
TIER_RANK = {"small": 0, "medium": 1, "large": 2}


@dataclass(frozen=True)
class Machine:
    ram_gb: int  # installed: only for the minimum
    usable_ram_bytes: int
    free_disk_gb: int
    cores: int  # physical processor cores
    memory_gbs: float | None  # system memory peak bandwidth
    card_free_bytes: int  # free memory on the graphics card the engine uses; 0 = none
    card_gbs: float | None  # the card's peak bandwidth


@dataclass(frozen=True)
class Measured:
    """A speed test: the model it ran and the engine build it ran on."""

    entry_id: str
    tokens_per_second: float
    build: str  # cpu | vulkan
    prompt_tokens_per_second: float | None = None  # reading the prompt; None if not measured


@dataclass(frozen=True)
class Estimate:
    entry: Entry
    runs_on: RunsOn | None  # None: it does not fit
    problem: Problem | None  # why it does not fit
    tokens_per_second: float | None  # writing speed
    first_word_s: float | None  # wait for the first word, with the model loaded
    measured: bool  # tokens_per_second is this computer's speed test, not an estimate
    card_bytes: float  # bytes read per token on the card ...
    memory_bytes: float  # ... and in system memory

    @property
    def fast_enough(self) -> bool:
        return (
            self.runs_on is not None
            and (self.tokens_per_second or 0) >= MIN_TOKENS_PER_SECOND
            and (self.first_word_s or 0) <= FIRST_WORD_LIMIT_S
        )


@dataclass(frozen=True)
class _Speeds:
    card: float  # effective bytes a second when writing
    memory: float
    card_read: float  # bytes of weights a second when reading the prompt
    memory_read: float


def _active(entry: Entry) -> tuple[int, float]:
    """(dense bytes, expert bytes read per token)."""
    expert = min(entry.expert_bytes, entry.size_bytes)
    return entry.size_bytes - expert, expert * entry.expert_share_per_token


def _placement(
    entry: Entry, m: Machine, installed: bool
) -> tuple[RunsOn | None, Problem | None, float, float]:
    """Where the model runs, why it cannot, and bytes read per token on the card and in system
    memory. An installed model already has its space on the drive."""
    if not installed and m.free_disk_gb * GIB < entry.size_bytes + WORKING_SPACE_BYTES:
        return None, "disk", 0.0, 0.0
    per_token = entry.context_bytes_per_token
    if per_token is None:
        per_token = DEFAULT_CONTEXT_BYTES_PER_TOKEN
    fixed = per_token * CONTEXT_TOKENS + ENGINE_BUFFERS_BYTES  # context and buffers
    card = max(0, m.card_free_bytes - CARD_MARGIN_BYTES)
    memory = max(0, m.usable_ram_bytes - SYSTEM_RESERVE_BYTES)
    dense, expert_read = _active(entry)
    expert = entry.size_bytes - dense
    share = entry.expert_share_per_token

    if entry.size_bytes + fixed <= card:
        return "card", None, dense + expert_read, 0.0
    if card > fixed and expert and dense + fixed <= card:
        on_card = card - dense - fixed  # experts that still fit next to the rest
        in_memory = expert - on_card
        if in_memory > memory:
            return None, "memory", 0.0, 0.0
        return "split", None, dense + on_card * share, in_memory * share
    if card > fixed:
        layers = (card - fixed) / entry.size_bytes  # share of the layers on the card
        if (1 - layers) * entry.size_bytes > memory:
            return None, "memory", 0.0, 0.0
        active = dense + expert_read
        return "split", None, layers * active, (1 - layers) * active
    if entry.size_bytes + fixed > memory:
        return None, "memory", 0.0, 0.0
    return "processor", None, 0.0, dense + expert_read


def _speeds(m: Machine) -> _Speeds:
    return _Speeds(
        card=(m.card_gbs or DEFAULT_CARD_GBS) * GB * CARD_EFFICIENCY,
        memory=(m.memory_gbs or DEFAULT_MEMORY_GBS) * GB * PROCESSOR_EFFICIENCY,
        card_read=CARD_READ_BYTES,
        memory_read=PROCESSOR_READ_BYTES_PER_CORE * max(1, m.cores),
    )


def _estimate(entry: Entry, m: Machine, s: _Speeds, installed: frozenset[str]) -> Estimate:
    runs_on, problem, card_bytes, memory_bytes = _placement(entry, m, entry.id in installed)
    if runs_on is None:
        return Estimate(entry, None, problem, None, None, False, 0.0, 0.0)
    seconds = card_bytes / s.card + memory_bytes / s.memory
    reading = card_bytes / s.card_read + memory_bytes / s.memory_read
    return Estimate(
        entry,
        runs_on,
        None,
        1 / seconds if seconds > 0 else None,
        TYPICAL_PROMPT_TOKENS * reading,
        False,
        card_bytes,
        memory_bytes,
    )


def estimate(
    machine: Machine,
    entries: Iterable[Entry],
    measured: Measured | None = None,
    installed: Iterable[str] = (),
) -> list[Estimate]:
    """Every entry on this machine. A speed test calibrates the part it ran on (the card for a
    model fully on the card on the GPU build, system memory for a model on the processor on the
    CPU build): its writing speed, and its prompt reading speed when the test measured it. A
    split model's test calibrates nothing."""
    entries = list(entries)
    have = frozenset(installed)
    speeds = _speeds(machine)
    found = [_estimate(e, machine, speeds, have) for e in entries]
    if measured is None:
        return found
    tested = next((x for x in found if x.entry.id == measured.entry_id), None)
    reads = measured.prompt_tokens_per_second
    if tested is not None and tested.runs_on == "card" and measured.build == "vulkan":
        speeds = replace(speeds, card=measured.tokens_per_second * tested.card_bytes)
        if reads:
            speeds = replace(speeds, card_read=reads * tested.card_bytes)
    elif tested is not None and tested.runs_on == "processor" and measured.build == "cpu":
        speeds = replace(speeds, memory=measured.tokens_per_second * tested.memory_bytes)
        if reads:
            speeds = replace(speeds, memory_read=reads * tested.memory_bytes)
    else:
        return found
    found = [_estimate(e, machine, speeds, have) for e in entries]
    return [
        replace(x, tokens_per_second=measured.tokens_per_second, measured=True)
        if x.entry.id == measured.entry_id
        else x
        for x in found
    ]


def _better(x: Estimate) -> tuple[int, float]:
    dense, expert_read = _active(x.entry)
    return TIER_RANK.get(x.entry.tier, 0), dense + expert_read


def pick(
    machine: Machine, estimates: Iterable[Estimate], installable: Callable[[Entry], bool]
) -> Estimate | None:
    """The one model to suggest, or None below the minimum or when nothing fits."""
    if machine.ram_gb < MIN_RAM_GB or machine.free_disk_gb < MIN_FREE_DISK_GB:
        return None
    runs = [x for x in estimates if x.runs_on is not None and installable(x.entry)]
    good = [x for x in runs if x.fast_enough]
    if good:
        return max(good, key=_better)
    if runs:
        return max(runs, key=lambda x: x.tokens_per_second or 0)
    return None
