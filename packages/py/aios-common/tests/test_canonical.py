from datetime import UTC, datetime

import pytest

from aios_common.canonical import b64url, b64url_decode, jcs, tagged_hash, utc_time


def test_jcs_sorts_keys_and_drops_whitespace() -> None:
    assert jcs({"b": 1, "a": [True, None, "x"]}) == b'{"a":[true,null,"x"],"b":1}'


def test_jcs_keeps_unicode_and_escapes_controls() -> None:
    assert jcs({"k": "é\n\u0001"}) == '{"k":"é\\n\\u0001"}'.encode()


def test_jcs_sorts_by_utf16_code_units() -> None:
    # U+FF61 sorts after U+1F600 by code point, but before it in UTF-16 (surrogates are 0xD8xx).
    assert jcs({"｡": 1, "\U0001f600": 2}).startswith('{"\U0001f600"'.encode())


@pytest.mark.parametrize("bad", [1.5, -1, 2**53])
def test_jcs_rejects_non_contract_numbers(bad: object) -> None:
    with pytest.raises((TypeError, ValueError)):
        jcs({"n": bad})


def test_tagged_hash_is_domain_separated() -> None:
    assert tagged_hash("a", b"b") != tagged_hash("ab", b"")
    assert len(tagged_hash("aios/x", b"")) == 64


def test_b64url_round_trip_without_padding() -> None:
    assert b64url(b"\xff\xfe") == "__4"
    assert b64url_decode("__4") == b"\xff\xfe"


def test_utc_time_has_milliseconds_and_z() -> None:
    assert (
        utc_time(datetime(2026, 10, 28, 9, 15, 2, 123456, tzinfo=UTC)) == "2026-10-28T09:15:02.123Z"
    )
