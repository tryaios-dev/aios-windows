"""My secure knowledge: documents copied into the encrypted store, read, listed, removed.

A file is copied into chats.db (encrypted by SQLCipher) and its text is read so the AI can use it.
The original is never moved or changed. A file AIOS cannot read is kept in the list with the reason
in plain words. Evidence records what happened without names or content (SR-07).
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


def add(client: TestClient, *paths: Path, collection: str | None = None) -> list[dict]:
    body: dict = {"paths": [str(p) for p in paths]}
    if collection is not None:
        body["collection"] = collection
    resp = client.post("/knowledge", json=body)
    assert resp.status_code == 200, resp.text
    return resp.json()


def write_docx(path: Path, text: str) -> None:
    import docx

    doc = docx.Document()
    doc.add_paragraph(text)
    doc.save(str(path))


def write_xlsx(path: Path, cells: list[list[str]]) -> None:
    import openpyxl

    book = openpyxl.Workbook()
    sheet = book.active
    for row in cells:
        sheet.append(row)
    book.save(str(path))


def write_pptx(path: Path, text: str) -> None:
    import pptx

    deck = pptx.Presentation()
    slide = deck.slides.add_slide(deck.slide_layouts[5])
    slide.shapes.title.text = text
    deck.save(str(path))


def write_pdf(path: Path, text: str) -> None:
    """A one-page PDF with a line of real text (no extra tools needed)."""
    content = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + obj + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (
        len(objects) + 1,
        xref,
    )
    path.write_bytes(bytes(out))


@pytest.fixture
def files(tmp_path: Path) -> Path:
    folder = tmp_path / "Client contracts"
    folder.mkdir()
    (folder / "notes.txt").write_text("The rent review is in March.", encoding="utf-8")
    write_docx(folder / "lease.docx", "The break clause applies after year three.")
    write_xlsx(folder / "budget.xlsx", [["Item", "Cost"], ["Printing", "120"]])
    write_pptx(folder / "plan.pptx", "Launch in April")
    write_pdf(folder / "terms.pdf", "Payment within thirty days")
    (folder / "photo.png").write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 64)
    (folder / "desktop.ini").write_text("[.ShellClassInfo]", encoding="utf-8")
    (folder / "~$lease.docx").write_bytes(b"lock")
    return folder


def test_adding_files_copies_and_reads_them(client: TestClient, files: Path) -> None:
    before = (files / "notes.txt").read_bytes()
    docs = add(client, files / "notes.txt", files / "lease.docx", files / "terms.pdf")
    by_name = {d["name"]: d for d in docs}
    assert {d["status"] for d in docs} == {"ready"}
    assert by_name["notes.txt"]["kind"] == "Text"
    assert by_name["lease.docx"]["kind"] == "Word"
    assert by_name["terms.pdf"]["kind"] == "PDF" and by_name["terms.pdf"]["pages"] == 1
    assert by_name["notes.txt"]["collection"] == "Added one by one"
    assert by_name["notes.txt"]["origin"] == str(files)
    assert (files / "notes.txt").read_bytes() == before  # the original is not changed
    assert {d["id"] for d in client.get("/knowledge").json()} == {d["id"] for d in docs}


def test_every_readable_kind_gives_its_text(client: TestClient, files: Path) -> None:
    docs = add(client, files / "budget.xlsx", files / "plan.pptx", files / "lease.docx")
    for doc in docs:
        text = client.get(f"/knowledge/{doc['id']}/text").json()["text"]
        assert {
            "budget.xlsx": "Printing",
            "plan.pptx": "Launch in April",
            "lease.docx": "break clause",
        }[doc["name"]] in text


def test_a_folder_is_added_as_one_collection_without_system_files(
    client: TestClient, files: Path
) -> None:
    resp = client.post("/knowledge/folder", json={"path": str(files)})
    assert resp.status_code == 200, resp.text
    docs = resp.json()
    names = {d["name"] for d in docs}
    assert "desktop.ini" not in names and "~$lease.docx" not in names
    assert {
        "notes.txt",
        "lease.docx",
        "budget.xlsx",
        "plan.pptx",
        "terms.pdf",
        "photo.png",
    } == names
    assert {d["collection"] for d in docs} == {"Client contracts"}


def test_a_folder_is_previewed_before_it_is_added(client: TestClient, files: Path) -> None:
    add(client, files / "notes.txt")
    resp = client.post("/knowledge/folder/preview", json={"path": str(files)})
    assert resp.status_code == 200, resp.text
    preview = resp.json()
    by_name = {f["name"]: f for f in preview["files"]}
    assert preview["name"] == "Client contracts" and "desktop.ini" not in by_name
    assert by_name["notes.txt"]["already"] is True and by_name["lease.docx"]["already"] is False
    assert "picture" in by_name["photo.png"]["problem"] and by_name["lease.docx"]["problem"] is None
    assert len(client.get("/knowledge").json()) == 1  # the preview adds nothing


def test_a_file_it_cannot_read_says_why(client: TestClient, files: Path, tmp_path: Path) -> None:
    (tmp_path / "archive.zip").write_bytes(b"PK\x03\x04" + b"\x00" * 30)
    write_pdf(tmp_path / "scan.pdf", "")  # a PDF with no text in it, like a scanned page
    docs = add(client, files / "photo.png", tmp_path / "archive.zip", tmp_path / "scan.pdf")
    reasons = {d["name"]: d for d in docs}
    assert {d["status"] for d in docs} == {"failed"}
    assert "picture" in reasons["photo.png"]["problem"]
    assert "Unzip" in reasons["archive.zip"]["problem"]
    assert "no text" in reasons["scan.pdf"]["problem"]


def test_adding_the_same_file_twice_keeps_one_copy(client: TestClient, files: Path) -> None:
    add(client, files / "notes.txt")
    add(client, files / "notes.txt")
    assert len(client.get("/knowledge").json()) == 1


def test_remove_and_retry(client: TestClient, files: Path) -> None:
    doc = add(client, files / "notes.txt")[0]
    assert client.post(f"/knowledge/{doc['id']}/retry").json()["status"] == "ready"
    assert client.delete(f"/knowledge/{doc['id']}").status_code == 204
    assert client.get("/knowledge").json() == []
    assert client.delete(f"/knowledge/{doc['id']}").status_code == 404
    assert (files / "notes.txt").exists()  # removing the copy never touches the original


def test_a_web_page_can_be_removed(client: TestClient, tmp_path: Path) -> None:
    """Its kind has a space ("Web page"): evidence records a plain code instead."""
    page = tmp_path / "page.html"
    page.write_text("<html><body><p>Hello there</p></body></html>", "utf-8")
    doc = add(client, page)[0]
    assert doc["kind"] == "Web page"
    assert client.delete(f"/knowledge/{doc['id']}").status_code == 204
    removed = [e for e in client.get("/evidence").json() if e["event_type"] == "knowledge_removed"]
    assert removed[-1]["payload"]["kind"] == "web-page"


def test_paths_must_be_absolute_existing_files(client: TestClient, tmp_path: Path) -> None:
    assert client.post("/knowledge", json={"paths": ["relative.txt"]}).json() == {
        "error": "invalid_path"
    }
    assert client.post("/knowledge", json={"paths": [str(tmp_path / "gone.txt")]}).json() == {
        "error": "invalid_path"
    }
    assert client.post("/knowledge/folder", json={"path": str(tmp_path / "nope")}).json() == {
        "error": "invalid_path"
    }


def test_knowledge_events_are_content_free(client: TestClient, files: Path) -> None:
    doc = add(client, files / "lease.docx")[0]
    client.delete(f"/knowledge/{doc['id']}")
    events = [e for e in client.get("/evidence").json() if e["event_type"].startswith("knowledge_")]
    assert [e["event_type"] for e in events] == ["knowledge_added", "knowledge_removed"]
    raw = json.dumps(events)
    assert "lease" not in raw and "break clause" not in raw and "Client contracts" not in raw


@pytest.fixture
def chat(settings: Settings, db: Database) -> Iterator[tuple[TestClient, FakeAnswers]]:
    model = FakeAnswers("Answered from your documents.")
    headers = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}
    with TestClient(create_app(settings, db, model), client=LOOPBACK, headers=headers) as c:
        yield c, model


def test_a_question_asked_with_documents_sends_their_text(
    chat: tuple[TestClient, FakeAnswers], files: Path
) -> None:
    client, model = chat
    doc = add(client, files / "notes.txt")[0]
    project = client.post("/projects", json={"name": "P", "classification": "internal"}).json()
    conv = client.post(f"/projects/{project['id']}/conversations", json={}).json()
    resp = client.post(
        f"/conversations/{conv['id']}/messages",
        json={"text": "When is the rent review?", "knowledge_ids": [doc["id"]]},
    )
    assert resp.status_code == 200, resp.text
    sent = model.calls[-1]["messages"]
    assert sent[0]["role"] == "system" and "The rent review is in March." in sent[0]["content"]
    assert sent[-1] == {"role": "user", "content": "When is the rent review?"}


def test_unknown_documents_are_refused(chat: tuple[TestClient, FakeAnswers]) -> None:
    client, _ = chat
    project = client.post("/projects", json={"name": "P", "classification": "internal"}).json()
    conv = client.post(f"/projects/{project['id']}/conversations", json={}).json()
    resp = client.post(
        f"/conversations/{conv['id']}/messages", json={"text": "Hi", "knowledge_ids": ["nope"]}
    )
    assert resp.status_code == 404 and resp.json() == {"error": "document_not_found"}
