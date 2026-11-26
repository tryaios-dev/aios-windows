"""The firmware memory table (SMBIOS type 17): type, speed and width give the bandwidth."""

import struct

from aios_common.platforms.smbios import MAX_BUS_BITS, Memory, parse_memory


def device(kind: int, size_mb: int, width: int, speed: int, configured: int) -> bytes:
    """A type 17 structure (SMBIOS 3.2 layout, 0x28 bytes) with no strings."""
    area = bytearray(0x28)
    area[0], area[1] = 17, len(area)
    struct.pack_into("<H", area, 0x08, width)  # total width
    struct.pack_into("<H", area, 0x0A, width)  # data width
    struct.pack_into("<H", area, 0x0C, size_mb)
    area[0x12] = kind
    struct.pack_into("<H", area, 0x15, speed)
    struct.pack_into("<H", area, 0x20, configured)
    return bytes(area) + b"\x00\x00"


def other(kind: int) -> bytes:
    return bytes([kind, 4, 0, 0]) + b"text\x00\x00"


END = bytes([127, 4, 0, 0]) + b"\x00\x00"
DDR5, LPDDR5 = 0x22, 0x23


def test_two_ddr5_modules_make_two_channels() -> None:
    table = other(0) + device(DDR5, 16384, 64, 5600, 5600) + device(DDR5, 16384, 64, 5600, 5600)
    memory = parse_memory(table + END)
    assert memory == Memory("DDR5", 5600, 128)
    assert memory.bandwidth_gbs == 89.6 and memory.label == "DDR5-5600"


def test_empty_slots_are_skipped_and_the_configured_speed_counts() -> None:
    table = device(DDR5, 16384, 64, 6400, 4800) + device(DDR5, 0, 64, 0, 0)
    assert parse_memory(table + END) == Memory("DDR5", 4800, 64)


def test_soldered_lpddr5_adds_up_its_narrow_packages() -> None:
    table = b"".join(device(LPDDR5, 4096, 16, 7500, 7500) for _ in range(8))
    assert parse_memory(table + END) == Memory("LPDDR5", 7500, 128)


def test_four_modules_on_two_channels_are_not_counted_twice() -> None:
    table = b"".join(device(0x1A, 8192, 64, 3200, 3200) for _ in range(4))
    assert parse_memory(table + END).bus_bits == MAX_BUS_BITS  # type: ignore[union-attr]


def test_an_unreadable_table_gives_nothing() -> None:
    assert parse_memory(b"") is None
    assert parse_memory(b"\x11\x02") is None
    assert parse_memory(other(1) + END) is None
