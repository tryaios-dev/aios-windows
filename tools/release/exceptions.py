"""Shared reader for docs/security/dependency-exceptions.json (B-05)."""

import datetime
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RECORD = ROOT / "docs" / "security" / "dependency-exceptions.json"


def accepted_ids() -> set[str]:
    """IDs with a reason that have not passed their review date."""
    today = datetime.date.today().isoformat()
    ids: set[str] = set()
    for e in json.loads(RECORD.read_text("utf-8"))["exceptions"]:
        if not e.get("reason"):
            raise SystemExit(f"exception {e.get('id')} has no reason")
        if e.get("review_by", "9999-12-31") >= today:
            ids.add(e["id"])
    return ids
