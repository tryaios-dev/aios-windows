"""E-03 / AC-17: the frozen reference Recovery Package still unwraps, and tampering is caught."""

import json
from pathlib import Path

import pytest

from aios_backend.apps.setup import recovery_package as rp
from aios_common.canonical import jcs

FOLDER = (
    Path(__file__).resolve().parents[3] / "contracts" / "recovery-package" / "v1" / "golden-vectors"
)
EXPECTED = json.loads((FOLDER / "expected.json").read_text())
REFERENCE = (FOLDER / "reference.pkg").read_bytes()


def test_ac_17_the_reference_package_unwraps_with_its_recovery_key() -> None:
    pkg = rp.read(REFERENCE)
    payload = rp.unwrap(pkg, rp.parse_recovery_key(EXPECTED["recovery_key"]))
    assert payload.db_key.hex() == EXPECTED["db_key_hex"]
    assert payload.signing_seed.hex() == EXPECTED["signing_seed_hex"]
    assert payload.stream_id == EXPECTED["stream_id"] == pkg["stream_id"]
    assert pkg["signing_key_id"] == EXPECTED["signing_key_id"]
    assert rp.required_files(pkg) == EXPECTED["required_files"]
    assert pkg["evidence_tip"]["seq"] == EXPECTED["evidence_tip_seq"]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("evidence_tip", None),  # pretend nothing was chained: lets a short chain pass
        ("backup_manifest", {"required": ["chats.db"], "excluded": []}),  # drop a required file
        ("security_state_revision", {"migration": "0001", "catalogue": None}),
        ("stream_id", "00000000-0000-4000-8000-000000000000"),
    ],
)
def test_ac_17_changing_any_header_field_breaks_the_unwrap(field: str, value: object) -> None:
    tampered = jcs({**json.loads(REFERENCE), field: value})
    with pytest.raises(rp.RecoveryError) as refused:
        rp.unwrap(rp.read(tampered), rp.parse_recovery_key(EXPECTED["recovery_key"]))
    assert refused.value.code == "R_UNWRAP"


def test_ac_17_a_wrong_recovery_key_is_refused() -> None:
    with pytest.raises(rp.RecoveryError) as refused:
        rp.unwrap(rp.read(REFERENCE), rp.new_recovery_key())
    assert refused.value.code == "R_UNWRAP"
