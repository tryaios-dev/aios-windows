"""The firmware's memory table (SMBIOS type 17): memory type, speed and bus width.

Pure parsing, the same on every OS; each platform only fetches the raw table (Windows:
``GetSystemFirmwareTable('RSMB')``). Writing an answer reads the whole model from memory for
every word, so the memory's bandwidth sets how fast a model runs on the processor.
"""

import struct
from dataclasses import dataclass

MEMORY_DEVICE = 17
END_OF_TABLE = 127

# SMBIOS 3.x, table 76 (Memory Device - Type).
KINDS = {
    0x18: "DDR3",
    0x1A: "DDR4",
    0x1B: "LPDDR",
    0x1C: "LPDDR2",
    0x1D: "LPDDR3",
    0x1E: "LPDDR4",
    0x22: "DDR5",
    0x23: "LPDDR5",
}
# A consumer board has two 64-bit channels; four DIMMs on it share them. Counting each DIMM's
# width would double the bandwidth, so the total width is capped at 128 bits.
MAX_BUS_BITS = 128


@dataclass(frozen=True)
class Memory:
    kind: str | None  # "DDR5", "LPDDR5", ... or None if the table does not say
    speed_mts: int  # configured speed, megatransfers a second
    bus_bits: int  # data width of the populated devices, capped at MAX_BUS_BITS

    @property
    def bandwidth_gbs(self) -> float:
        """Peak bandwidth in GB/s (10**9 bytes)."""
        return self.speed_mts * self.bus_bits / 8 / 1000

    @property
    def label(self) -> str:
        """e.g. "DDR5-5600"."""
        return f"{self.kind or 'Memory'}-{self.speed_mts}"


def _structures(table: bytes) -> list[tuple[int, bytes]]:
    """(type, formatted area) of every structure, up to the end-of-table marker."""
    found, i = [], 0
    while i + 4 <= len(table):
        kind, length = table[i], table[i + 1]
        if length < 4 or i + length > len(table):
            break
        found.append((kind, table[i : i + length]))
        end = table.find(b"\x00\x00", i + length)  # strings end with a double NUL
        if end < 0 or kind == END_OF_TABLE:
            break
        i = end + 2
    return found


def _word(area: bytes, offset: int) -> int | None:
    return struct.unpack_from("<H", area, offset)[0] if len(area) >= offset + 2 else None


def _dword(area: bytes, offset: int) -> int | None:
    return struct.unpack_from("<I", area, offset)[0] if len(area) >= offset + 4 else None


def _speed(area: bytes) -> int:
    """Configured speed, else rated speed; 0xFFFF means "see the 32-bit field" (SMBIOS 3.3)."""
    for short, extended in ((0x20, 0x58), (0x15, 0x54)):
        value = _word(area, short)
        if value == 0xFFFF:
            value = _dword(area, extended)
        if value:
            return value
    return 0


def parse_memory(table: bytes) -> Memory | None:
    """The memory in the computer, from the raw SMBIOS table (without the Windows header), or
    None if no populated device gives a speed and width."""
    kinds, speeds, bits = [], [], 0
    for kind, area in _structures(table):
        if kind != MEMORY_DEVICE or len(area) < 0x17:
            continue
        size = _word(area, 0x0C)
        width = _word(area, 0x0A)
        if not size or size == 0xFFFF or not width or width == 0xFFFF:
            continue  # empty slot, or unknown
        speed = _speed(area)
        if not speed:
            continue
        kinds.append(KINDS.get(area[0x12]))
        speeds.append(speed)
        bits += width
    if not speeds:
        return None
    # Mixed modules all run at the slowest one's speed.
    label = kinds[0] if len(set(kinds)) == 1 else None
    return Memory(label, min(speeds), min(bits, MAX_BUS_BITS))
