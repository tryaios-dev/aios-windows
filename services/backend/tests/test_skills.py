"""Add skills to my AI: listed skills, a skill of your own from a file, and what chat sends.

A skill is an instruction the AI follows while it is on. Included skills cannot be removed;
added ones can be turned off or removed. A skill file is checked and shown before it is added.
"""

import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from tests.conftest import LAUNCH_TOKEN, LOOPBACK, FakeAnswers

from aios_backend.config import Settings
from aios_backend.main import create_app
from db.session import Database


def test_the_list_has_included_and_addable_skills(client: TestClient) -> None:
    body = client.get("/skills").json()
    by_id = {s["id"]: s for s in body["catalogue"]}
    assert by_id["write"]["included"] and by_id["read-documents"]["included"]
    assert not by_id["minutes"]["included"] and by_id["minutes"]["size_bytes"] > 0
    assert body["installed"] == []


def test_add_turn_off_and_remove_a_skill(client: TestClient) -> None:
    added = client.post("/skills/minutes")
    assert added.status_code == 200 and added.json()["enabled"] is True
    assert client.post("/skills/minutes").json() == {"error": "skill_added"}
    assert client.put("/skills/minutes/enabled", json={"enabled": False}).json()["enabled"] is False
    assert [s["enabled"] for s in client.get("/skills").json()["installed"]] == [False]
    assert client.delete("/skills/minutes").status_code == 204
    assert client.get("/skills").json()["installed"] == []
    assert client.delete("/skills/minutes").json() == {"error": "skill_not_found"}


def test_voice_notes_is_listed_but_not_in_this_build(client: TestClient) -> None:
    voice = next(s for s in client.get("/skills").json()["catalogue"] if s["id"] == "voice")
    assert voice["available"] is False and voice["name"] == "Voice notes"
    assert client.post("/skills/voice").json() == {"error": "skill_not_in_build"}
    assert client.get("/skills").json()["installed"] == []


def test_included_skills_cannot_be_added_or_removed(client: TestClient) -> None:
    assert client.post("/skills/write").json() == {"error": "skill_included"}
    assert client.delete("/skills/write").json() == {"error": "skill_included"}
    assert client.post("/skills/nope").json() == {"error": "skill_not_found"}


def test_skill_events_name_the_skill_but_not_its_instruction(client: TestClient) -> None:
    client.post("/skills/contracts")
    client.delete("/skills/contracts")
    events = [e for e in client.get("/evidence").json() if e["event_type"].startswith("skill_")]
    assert [e["event_type"] for e in events] == ["skill_installed", "skill_removed"]
    assert events[0]["payload"]["skill_id"] == "contracts"
    assert "legal advice" not in json.dumps(events)


@pytest.fixture
def skill_file(tmp_path: Path) -> Path:
    path = tmp_path / "invoice-reader.aios-skill"
    path.write_text(
        json.dumps(
            {
                "name": "Invoice reader",
                "line": "Pull the supplier, dates, amounts and VAT out of invoices.",
                "category": "Documents",
                "version": "0.4.0",
                "uses": ["The conversation you are in"],
                "example": "List the totals from the March invoices.",
                "instruction": "List supplier, invoice number, date, net, VAT and total.",
            }
        ),
        encoding="utf-8",
    )
    return path


def test_a_skill_file_is_checked_before_it_is_added(client: TestClient, skill_file: Path) -> None:
    check = client.post("/skills/file/check", json={"path": str(skill_file)}).json()
    assert check["entry"]["name"] == "Invoice reader" and check["entry"]["own"] is True
    assert check["entry"]["publisher"] == "Added by you" and check["already_added"] is False
    assert client.get("/skills").json()["installed"] == []  # the check adds nothing

    added = client.post("/skills/file", json={"path": str(skill_file)}).json()
    assert added["id"] == "own-invoice-reader"
    listed = client.get("/skills").json()
    assert any(s["id"] == "own-invoice-reader" and s["own"] for s in listed["catalogue"])
    assert client.post("/skills/file/check", json={"path": str(skill_file)}).json()["already_added"]
    assert client.post("/skills/file", json={"path": str(skill_file)}).json() == {
        "error": "skill_added"
    }


def test_bad_skill_files_are_refused(client: TestClient, tmp_path: Path) -> None:
    wrong = tmp_path / "notes.txt"
    wrong.write_text("{}", encoding="utf-8")
    broken = tmp_path / "broken.aios-skill"
    broken.write_text("not json", encoding="utf-8")
    empty = tmp_path / "empty.aios-skill"
    empty.write_text(json.dumps({"name": "X"}), encoding="utf-8")
    check = "/skills/file/check"
    assert client.post(check, json={"path": str(wrong)}).json() == {"error": "not_a_skill_file"}
    assert client.post(check, json={"path": str(broken)}).json() == {"error": "skill_file_invalid"}
    assert client.post(check, json={"path": str(empty)}).json() == {"error": "skill_file_invalid"}
    assert client.post(check, json={"path": "relative.aios-skill"}).json() == {
        "error": "invalid_path"
    }


@pytest.fixture
def chat(settings: Settings, db: Database) -> Iterator[tuple[TestClient, FakeAnswers]]:
    model = FakeAnswers("Done.")
    headers = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}
    with TestClient(create_app(settings, db, model), client=LOOPBACK, headers=headers) as c:
        yield c, model


def test_a_skill_that_is_on_goes_with_each_question(chat: tuple[TestClient, FakeAnswers]) -> None:
    client, model = chat
    project = client.post("/projects", json={"name": "P", "classification": "internal"}).json()
    conv = client.post(f"/projects/{project['id']}/conversations", json={}).json()
    client.post("/skills/minutes")
    client.post(f"/conversations/{conv['id']}/messages", json={"text": "Notes: A agreed."})
    sent = model.calls[-1]["messages"]
    assert sent[0]["role"] == "system" and "Meeting minutes skill" in sent[0]["content"]

    client.put("/skills/minutes/enabled", json={"enabled": False})
    client.post(f"/conversations/{conv['id']}/messages", json={"text": "Again."})
    assert all("Meeting minutes skill" not in m["content"] for m in model.calls[-1]["messages"])
