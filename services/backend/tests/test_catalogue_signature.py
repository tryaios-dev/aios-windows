"""Model Catalogue v1 sections 5 and 6, steps 1 to 3, against the golden vectors (A-03, L-02).

A tampered catalogue (one byte changed, another key, not canonical, wrong version, older than the
last one) is refused with its code before any entry is used.
"""

import json
from pathlib import Path

import pytest

from aios_backend.apps.models.catalogue import CatalogueRejected, verify_signed
from aios_common.canonical import b64url_decode

VECTORS = (
    Path(__file__).resolve().parents[3] / "contracts" / "model-catalogue" / "v1" / "golden-vectors"
)
NAMES = sorted(p.name for p in VECTORS.iterdir() if p.is_dir())


def test_every_section_6_rejection_has_a_vector() -> None:
    results = {json.loads((VECTORS / n / "expected.json").read_text())["result"] for n in NAMES}
    assert results == {"accept", "C_SIG", "C_UNKNOWN_KEY", "C_FORMAT", "C_ROLLBACK"}


@pytest.mark.parametrize("name", NAMES)
def test_golden_vector(name: str) -> None:
    folder = VECTORS / name
    expected = json.loads((folder / "expected.json").read_text())
    trusted = {k["key_id"]: b64url_decode(k["public_key"]) for k in expected["trusted_keys"]}
    args = (
        (folder / "catalogue.json").read_bytes(),
        (folder / "catalogue.json.sig").read_bytes(),
        trusted,
        expected["last_accepted_issued_at"],
    )
    if expected["result"] == "accept":
        issued_at, entries = verify_signed(*args)
        assert issued_at == "2026-11-20T10:00:00.000Z"
        assert [e.id for e in entries] == ["test-model-q4_k_m"]
    else:
        with pytest.raises(CatalogueRejected) as err:
            verify_signed(*args)
        assert err.value.code == expected["result"]


def test_a_signature_file_that_is_not_json_is_refused() -> None:
    folder = VECTORS / "valid"
    with pytest.raises(CatalogueRejected) as err:
        verify_signed((folder / "catalogue.json").read_bytes(), b"not json", {}, None)
    assert err.value.code == "C_SIG"
