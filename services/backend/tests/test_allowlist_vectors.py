"""G-08 / AC-21: the backend's network door gives the contract's answer for every golden case."""

import json
from pathlib import Path

import pytest

from aios_backend import net

FOLDER = (
    Path(__file__).resolve().parents[3]
    / "contracts"
    / "network-allowlist"
    / "v1"
    / "golden-vectors"
)
CASES = json.loads((FOLDER / "cases.json").read_text(encoding="utf-8"))["cases"]


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_ac_21_allowlist_golden_case(case: dict[str, object]) -> None:
    company = case["company"]
    allowlist = net.Allowlist(company=lambda: company)  # type: ignore[arg-type,return-value]
    assert allowlist.allows(str(case["url"])) is case["allowed"]


def test_ac_21_the_vectors_use_the_contract_hosts() -> None:
    listed = json.loads((FOLDER.parent / "allowlist.json").read_text(encoding="utf-8"))
    fixed = {(f["host"], f["port"]) for f in listed["flows"] if f["host"] != "configured"}
    assert fixed == set(net.FIXED)
