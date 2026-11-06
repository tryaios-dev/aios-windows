import json

from fastapi.testclient import TestClient
from tests.conftest import FakeAnswers

from aios_common.canonical import b64url_decode, jcs, tagged_hash
from db.models import Message
from db.session import Database


def setup_conversation(client: TestClient) -> tuple[dict, dict]:
    project = client.post("/projects", json={"name": "P", "classification": "internal"}).json()
    conv = client.post(f"/projects/{project['id']}/conversations", json={}).json()
    return project, conv


def test_conversation_inherits_project_classification(client: TestClient) -> None:
    _, conv = setup_conversation(client)
    assert conv["title"] == "New conversation"
    assert conv["classification_effective"] == "internal"
    assert conv["current_provider"] == "local" and conv["moves"] == []


def test_without_a_model_nothing_is_sent_or_stored(client: TestClient) -> None:
    _, conv = setup_conversation(client)
    resp = client.post(f"/conversations/{conv['id']}/messages", json={"text": "hi"})
    assert resp.status_code == 409 and resp.json() == {"error": "no_model"}
    assert client.get(f"/conversations/{conv['id']}/messages").json() == []
    assert client.get("/providers/status").json() == {
        "local_ready": False,
        "company_enabled": False,
    }


def test_send_stores_both_sides_and_names_the_conversation(chat: TestClient) -> None:
    _, conv = setup_conversation(chat)
    out = chat.post(
        f"/conversations/{conv['id']}/messages", json={"text": "  What is AIOS?  "}
    ).json()
    assert out["user"]["content"] == "What is AIOS?"
    assert out["assistant"]["content"] == "A local answer."
    assert out["assistant"]["status"] == "complete" and out["assistant"]["evidence_pending"] is True

    convs = chat.get(f"/projects/{conv['project_id']}/conversations").json()
    assert convs[0]["title"] == "What is AIOS?"
    assert convs[0]["last_message_preview"] == "A local answer."


def test_history_is_sent_as_context(chat: TestClient, answers: FakeAnswers) -> None:
    _, conv = setup_conversation(chat)
    chat.post(f"/conversations/{conv['id']}/messages", json={"text": "one"})
    chat.post(f"/conversations/{conv['id']}/messages", json={"text": "two"})
    assert [m["content"] for m in answers.calls[-1]["messages"]] == [
        "one",
        "A local answer.",
        "two",
    ]


def test_commitments_bind_content_without_revealing_it(chat: TestClient, db: Database) -> None:
    _, conv = setup_conversation(chat)
    out = chat.post(f"/conversations/{conv['id']}/messages", json={"text": "secret text"}).json()
    event = chat.get("/evidence").json()[-1]
    assert event["event_type"] == "inference_completed"
    assert "secret" not in json.dumps(event) and "answer" not in json.dumps(event)

    with db.session() as s:
        msg = s.get(Message, out["assistant"]["id"])
        assert msg is not None and msg.output_nonce and msg.input_nonce
        nonce = b64url_decode(msg.output_nonce)
        assert event["payload"]["output_commitment"] == tagged_hash(
            "aios/evidence/v1/commit/output", nonce + b"A local answer."
        )
        ctx = {"model": "qwen3-8b-q4km", "messages": [{"role": "user", "content": "secret text"}]}
        assert event["payload"]["input_commitment"] == tagged_hash(
            "aios/evidence/v1/commit/input", b64url_decode(msg.input_nonce) + jcs(ctx)
        )


def test_too_large_message_is_refused_and_recorded(chat: TestClient, answers: FakeAnswers) -> None:
    answers.context_length = 2000  # budget: 2000 - 1500 - 220 = 280 tokens
    _, conv = setup_conversation(chat)
    resp = chat.post(f"/conversations/{conv['id']}/messages", json={"text": "x" * 2000})
    assert resp.status_code == 413 and resp.json() == {"error": "message_too_large"}
    assert chat.get(f"/conversations/{conv['id']}/messages").json() == []
    assert chat.get("/evidence").json()[-1]["event_type"] == "refusal"


def test_interrupted_answer_is_kept_as_partial(chat: TestClient, answers: FakeAnswers) -> None:
    answers.text, answers.fail_after = "one two three four", 2
    _, conv = setup_conversation(chat)
    out = chat.post(f"/conversations/{conv['id']}/messages", json={"text": "go"}).json()
    assert out["assistant"]["content"] == "one two" and out["assistant"]["status"] == "partial"
    assert chat.get("/evidence").json()[-1]["payload"]["status"] == "cancelled"


def test_regenerate_keeps_the_previous_answer(chat: TestClient, answers: FakeAnswers) -> None:
    _, conv = setup_conversation(chat)
    chat.post(f"/conversations/{conv['id']}/messages", json={"text": "q"})
    answers.text = "A better answer."
    out = chat.post(f"/conversations/{conv['id']}/regenerate").json()
    assert out["assistant"]["content"] == "A better answer."
    assert out["assistant"]["previous_versions"] == ["A local answer."]
    assert len(chat.get(f"/conversations/{conv['id']}/messages").json()) == 2


def test_m09_moving_to_company_needs_the_flag(client: TestClient) -> None:
    _, conv = setup_conversation(client)
    resp = client.post(
        f"/conversations/{conv['id']}/provider", json={"to": "company", "confirmed": True}
    )
    assert resp.status_code == 409 and resp.json() == {"error": "company_provider_disabled"}


def test_rename_archive_delete(client: TestClient) -> None:
    _, conv = setup_conversation(client)
    out = client.patch(
        f"/conversations/{conv['id']}", json={"title": "Renamed", "archived": True}
    ).json()
    assert (out["title"], out["archived"]) == ("Renamed", True)
    assert client.delete(f"/conversations/{conv['id']}").status_code == 204
    assert client.get(f"/conversations/{conv['id']}/messages").status_code == 404
    types = [e["event_type"] for e in client.get("/evidence").json()]
    assert types == ["project_created", "conversation_created", "conversation_deleted"]
