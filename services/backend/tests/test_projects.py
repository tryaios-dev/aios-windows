import json
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from aios_backend.apps.projects import package
from aios_common.canonical import jcs


def event_types(client: TestClient) -> list[str]:
    return [e["event_type"] for e in client.get("/evidence").json()]


def make_project(client: TestClient, name: str = "Supplier FAQ", cls: str = "internal") -> dict:
    resp = client.post("/projects", json={"name": name, "classification": cls})
    assert resp.status_code == 201
    return resp.json()


def test_create_list_rename_archive_delete(client: TestClient) -> None:
    p = make_project(client)
    assert p["classification_source"] == "project" and p["company_ai_enabled"] is False
    assert [x["id"] for x in client.get("/projects").json()] == [p["id"]]

    renamed = client.patch(f"/projects/{p['id']}", json={"name": "  "}).json()
    assert renamed["name"] == "Untitled project"
    assert client.patch(f"/projects/{p['id']}", json={"archived": True}).json()["archived"] is True

    assert client.delete(f"/projects/{p['id']}").status_code == 204
    assert client.get(f"/projects/{p['id']}").json() == {"error": "project_not_found"}
    assert event_types(client) == ["project_created", "project_deleted"]


def test_deleting_a_project_deletes_its_conversations(chat: TestClient) -> None:
    p = make_project(chat)
    conv = chat.post(f"/projects/{p['id']}/conversations", json={}).json()
    chat.post(f"/conversations/{conv['id']}/messages", json={"text": "hello"})
    chat.delete(f"/projects/{p['id']}")
    assert chat.get(f"/conversations/{conv['id']}/messages").status_code == 404
    assert chat.get("/search", params={"q": "hello"}).json() == []


def test_m04_raising_classification_is_in_place(client: TestClient) -> None:
    p = make_project(client, cls="public")
    out = client.post(f"/projects/{p['id']}/reclassify", json={"to": "restricted"}).json()
    assert out["reviewed_copy"] is False
    assert out["project"]["id"] == p["id"] and out["project"]["classification"] == "restricted"


def test_m04_lowering_creates_a_reviewed_copy_and_keeps_the_original(chat: TestClient) -> None:
    p = make_project(chat, cls="restricted")
    conv = chat.post(f"/projects/{p['id']}/conversations", json={}).json()
    chat.post(f"/conversations/{conv['id']}/messages", json={"text": "question"})

    out = chat.post(f"/projects/{p['id']}/reclassify", json={"to": "internal"}).json()
    copy = out["project"]
    assert out["reviewed_copy"] is True
    assert copy["name"] == "Supplier FAQ (Internal copy)"
    assert copy["classification_source"] == "review" and copy["derived_from_project_id"] == p["id"]
    assert chat.get(f"/projects/{p['id']}").json()["classification"] == "restricted"

    copied = chat.get(f"/projects/{copy['id']}/conversations").json()
    assert len(copied) == 1 and copied[0]["classification_effective"] == "internal"
    msgs = chat.get(f"/conversations/{copied[0]['id']}/messages").json()
    assert [m["content"] for m in msgs] == ["question", "A local answer."]
    assert {m["classification_source"] for m in msgs} == {"review"}


def test_m09_company_ai_needs_the_operator_flag_and_a_confirmation(client: TestClient) -> None:
    p = make_project(client)
    resp = client.put(f"/projects/{p['id']}/company-ai", json={"enabled": True, "confirmed": True})
    assert resp.status_code == 409 and resp.json() == {"error": "company_provider_disabled"}


def test_evidence_bodies_never_hold_names(client: TestClient) -> None:
    make_project(client, name="Secret merger plan")
    for event in client.get("/evidence").json():
        assert "Secret" not in json.dumps(event)


# ------------------------------------------------------------------ Project Package v1
def test_export_then_import_round_trip(chat: TestClient, tmp_path: Path) -> None:
    p = make_project(chat)
    conv = chat.post(f"/projects/{p['id']}/conversations", json={}).json()
    chat.post(f"/conversations/{conv['id']}/messages", json={"text": "Payment terms?"})

    target = tmp_path / "supplier.aiosproj"
    out = chat.post(f"/projects/{p['id']}/export", json={"path": str(target)}).json()
    assert out["file_name"] == "supplier.aiosproj" and out["size_bytes"] == target.stat().st_size
    assert out["evidence_seq"] is None  # pending until the evidence writer appends it

    with zipfile.ZipFile(target) as zf:
        names = zf.namelist()
        assert names[0] == "manifest.json" and zf.infolist()[0].compress_type == zipfile.ZIP_STORED
        assert f"conversations/{conv['id']}.json" in names

    imported = chat.post("/projects/import", json={"path": str(target)}).json()
    assert imported["project_name"] == "Supplier FAQ (imported)" and imported["remapped"] is True
    assert (imported["conversations"], imported["messages"]) == (1, 2)
    new = chat.get(f"/projects/{imported['project_id']}").json()
    assert new["classification"] == "internal" and new["classification_source"] == "import"
    convs = chat.get(f"/projects/{new['id']}/conversations").json()
    assert convs[0]["id"] != conv["id"]  # always new ids
    assert event_types(chat)[-2:] == ["project_exported", "project_imported"]


def test_restricted_export_needs_confirmation(client: TestClient, tmp_path: Path) -> None:
    p = make_project(client, cls="restricted")
    body = {"path": str(tmp_path / "x.aiosproj")}
    assert client.post(f"/projects/{p['id']}/export", json=body).json() == {
        "error": "confirmation_required"
    }
    assert (
        client.post(f"/projects/{p['id']}/export", json=body | {"confirmed": True}).status_code
        == 200
    )


def test_export_path_must_be_an_absolute_aiosproj(client: TestClient) -> None:
    p = make_project(client)
    for path in ("relative.aiosproj", "C:/x/file.zip"):
        assert client.post(f"/projects/{p['id']}/export", json={"path": path}).status_code == 400


def _package(tmp_path: Path, client: TestClient) -> Path:
    p = make_project(client)
    path = tmp_path / "p.aiosproj"
    client.post(f"/projects/{p['id']}/export", json={"path": str(path)})
    return path


def _rewrite(src: Path, dst: Path, change: dict[str, bytes | None]) -> Path:
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, "w") as zout:
        for info in zin.infolist():
            data = change.get(info.filename, zin.read(info))
            if data is not None:
                zout.writestr(info, data)
        for name, data in change.items():
            if name not in zin.namelist() and data is not None:
                zout.writestr(name, data)
    return dst


def test_damaged_package_is_rejected_and_nothing_is_imported(
    client: TestClient, tmp_path: Path
) -> None:
    src = _package(tmp_path, client)
    with zipfile.ZipFile(src) as zf:
        project = json.loads(zf.read("project.json"))
    damaged = _rewrite(
        src, tmp_path / "bad.aiosproj", {"project.json": jcs({**project, "name": "Other"})}
    )
    before = len(client.get("/projects").json())
    assert client.post("/projects/import", json={"path": str(damaged)}).json() == {
        "error": "p_checksum"
    }
    assert len(client.get("/projects").json()) == before


def test_unlisted_and_traversal_entries_are_rejected(client: TestClient, tmp_path: Path) -> None:
    src = _package(tmp_path, client)
    extra = _rewrite(src, tmp_path / "extra.aiosproj", {"../evil.json": b"{}"})
    assert client.post("/projects/import", json={"path": str(extra)}).json() == {"error": "p_zip"}


def test_package_reader_checks_references() -> None:
    project = {
        "id": "11111111-1111-4111-8111-111111111111",
        "name": "P",
        "description": None,
        "classification": "public",
        "created_at": "2026-10-28T09:15:02.123Z",
        "updated_at": "2026-10-28T09:15:02.123Z",
    }
    conv = {
        "id": "22222222-2222-4222-8222-222222222222",
        "project_id": "33333333-3333-4333-8333-333333333333",  # not the package's project
        "title": "T",
        "classification": "public",
        "created_at": project["created_at"],
        "updated_at": project["created_at"],
        "messages": [],
        "summaries": [],
    }
    built = package.build(project, [conv], "0.1.0")
    try:
        package.read(built.data)
    except package.PackageError as exc:
        assert exc.code == "P_REFERENCE"
    else:
        raise AssertionError("expected P_REFERENCE")
