import json
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from aios_backend.apps.projects import package
from aios_common.canonical import jcs, sha256_hex


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


PROJECT_FILE = {
    "id": "11111111-1111-4111-8111-111111111111",
    "name": "P",
    "description": None,
    "classification": "public",
    "classification_source": "project",
    "created_at": "2026-10-28T09:15:02.123Z",
    "updated_at": "2026-10-28T09:15:02.123Z",
}


def test_package_reader_checks_references() -> None:
    conv = {
        "id": "22222222-2222-4222-8222-222222222222",
        "project_id": "33333333-3333-4333-8333-333333333333",  # not the package's project
        "title": "T",
        "classification_effective": "public",
        "classification_source": "project",
        "created_at": PROJECT_FILE["created_at"],
        "updated_at": PROJECT_FILE["created_at"],
        "messages": [],
    }
    built = package.build(PROJECT_FILE, [conv], {}, [], "0.1.0")
    try:
        package.read(built.data)
    except package.PackageError as exc:
        assert exc.code == "P_REFERENCE"
    else:
        raise AssertionError("expected P_REFERENCE")


# ------------------------------------------------------------------ MVP 9.5 layout (J-01, J-02)
def test_m14_export_has_the_mvp_layout_and_checksums(chat: TestClient, tmp_path: Path) -> None:
    p = make_project(chat)
    conv = chat.post(f"/projects/{p['id']}/conversations", json={}).json()
    chat.post(f"/conversations/{conv['id']}/messages", json={"text": "Payment terms?"})
    target = tmp_path / "layout.aiosproj"
    chat.post(f"/projects/{p['id']}/export", json={"path": str(target)})
    with zipfile.ZipFile(target) as zf:
        names = set(zf.namelist())
        assert {"manifest.json", "project.json", "models.json", "checksums.txt"} <= names
        assert f"conversations/{conv['id']}.json" in names
        manifest = json.loads(zf.read("manifest.json"))
        checksums = zf.read("checksums.txt")
        assert manifest["v"] == 1 and manifest["checksums_sha256"] == sha256_hex(checksums)
        assert manifest["export_event_id"] and manifest["schema_versions"]
        for line in checksums.decode().splitlines():
            digest, name = line.split("  ")
            assert sha256_hex(zf.read(name)) == digest
        conversation = json.loads(zf.read(f"conversations/{conv['id']}.json"))
        for item in [conversation, *conversation["messages"]]:
            assert item["classification_effective"] == "internal"
            assert item["classification_source"] == "project"


def test_m14_a_tampered_checksums_file_is_rejected(client: TestClient, tmp_path: Path) -> None:
    src = _package(tmp_path, client)
    with zipfile.ZipFile(src) as zf:
        text = zf.read("checksums.txt").decode()
    changed = text.replace(text[:4], "0000", 1).encode()
    bad = _rewrite(src, tmp_path / "bad-sums.aiosproj", {"checksums.txt": changed})
    assert client.post("/projects/import", json={"path": str(bad)}).json() == {
        "error": "p_checksum"
    }


def test_ac_16_a_newer_package_version_is_refused_by_name(
    client: TestClient, tmp_path: Path
) -> None:
    src = _package(tmp_path, client)
    with zipfile.ZipFile(src) as zf:
        manifest = json.loads(zf.read("manifest.json"))
    newer = _rewrite(src, tmp_path / "v2.aiosproj", {"manifest.json": jcs({**manifest, "v": 2})})
    assert client.post("/projects/import", json={"path": str(newer)}).json() == {
        "error": "p_version_2"
    }


def test_m14_unknown_files_are_skipped_with_a_warning(client: TestClient, tmp_path: Path) -> None:
    src = _package(tmp_path, client)
    extra = _rewrite(src, tmp_path / "extra-file.aiosproj", {"attachments/readme.txt": b"hi"})
    out = client.post("/projects/import", json={"path": str(extra)}).json()
    assert any("attachments/readme.txt" in w for w in out["warnings"]), out


def test_m14_unknown_fields_and_the_original_source_survive_a_round_trip(
    chat: TestClient, tmp_path: Path
) -> None:
    p = make_project(chat)
    conv = chat.post(f"/projects/{p['id']}/conversations", json={}).json()
    chat.post(f"/conversations/{conv['id']}/messages", json={"text": "hello"})
    src = tmp_path / "src.aiosproj"
    chat.post(f"/projects/{p['id']}/export", json={"path": str(src)})

    # A later version added fields this one does not know.
    with zipfile.ZipFile(src) as zf:
        files = {n: zf.read(n) for n in zf.namelist()}
    project = json.loads(files["project.json"]) | {
        "colour": "teal",
        "classification_source": "review",
    }
    conversation = json.loads(files[f"conversations/{conv['id']}.json"])
    conversation["messages"][0]["reaction"] = "thumbs_up"
    files["project.json"] = jcs(project)
    files[f"conversations/{conv['id']}.json"] = jcs(conversation)
    body = {n: d for n, d in files.items() if n not in ("manifest.json", "checksums.txt")}
    sums = package.checksums_text(body)
    manifest = json.loads(files["manifest.json"]) | {"checksums_sha256": sha256_hex(sums)}
    changed = _rewrite(
        src,
        tmp_path / "newer-fields.aiosproj",
        {**body, "checksums.txt": sums, "manifest.json": jcs(manifest)},
    )
    imported = chat.post("/projects/import", json={"path": str(changed)}).json()
    assert "error" not in imported, imported

    again = tmp_path / "again.aiosproj"
    chat.post(f"/projects/{imported['project_id']}/export", json={"path": str(again)})
    with zipfile.ZipFile(again) as zf:
        project_out = json.loads(zf.read("project.json"))
        conv_name = next(n for n in zf.namelist() if n.startswith("conversations/"))
        conv_out = json.loads(zf.read(conv_name))
    assert project_out["colour"] == "teal"
    assert project_out["classification_source"] == "import"
    assert conv_out["messages"][0]["reaction"] == "thumbs_up"
    with chat.app.state.db.session() as s:  # type: ignore[attr-defined]
        from db.models import Project

        row = s.get(Project, imported["project_id"])
        assert row is not None
        assert json.loads(row.extensions)["imported_classification_source"] == "review"


def test_m14_importing_the_same_package_twice_gives_two_independent_projects(
    chat: TestClient, tmp_path: Path
) -> None:
    p = make_project(chat)
    conv = chat.post(f"/projects/{p['id']}/conversations", json={}).json()
    chat.post(f"/conversations/{conv['id']}/messages", json={"text": "hello"})
    src = tmp_path / "twice.aiosproj"
    chat.post(f"/projects/{p['id']}/export", json={"path": str(src)})
    first = chat.post("/projects/import", json={"path": str(src)}).json()
    second = chat.post("/projects/import", json={"path": str(src)}).json()
    assert first["project_id"] != second["project_id"]
    a = chat.get(f"/projects/{first['project_id']}/conversations").json()
    b = chat.get(f"/projects/{second['project_id']}/conversations").json()
    assert {c["id"] for c in a}.isdisjoint({c["id"] for c in b})
    chat.delete(f"/projects/{first['project_id']}")
    assert len(chat.get(f"/projects/{second['project_id']}/conversations").json()) == 1


def test_m14_identifiers_travel_unchanged_to_another_store(
    chat: TestClient, client: TestClient, tmp_path: Path
) -> None:
    """``client`` and ``chat`` share one test database here, so the other store is simulated by
    deleting the project before importing: no identifier collides, and none changes."""
    p = make_project(chat)
    conv = chat.post(f"/projects/{p['id']}/conversations", json={}).json()
    src = tmp_path / "move.aiosproj"
    chat.post(f"/projects/{p['id']}/export", json={"path": str(src)})
    chat.delete(f"/projects/{p['id']}")
    out = chat.post("/projects/import", json={"path": str(src)}).json()
    assert out["project_id"] == p["id"]
    assert [c["id"] for c in chat.get(f"/projects/{p['id']}/conversations").json()] == [conv["id"]]


def test_ac_05_a_new_project_is_restricted_unless_chosen(client: TestClient) -> None:
    resp = client.post("/projects", json={"name": "No class given"})
    assert resp.status_code == 201
    assert resp.json()["classification"] == "restricted"


def test_m04_raising_reaches_every_message_and_summary(chat: TestClient, db) -> None:  # type: ignore[no-untyped-def]
    from sqlalchemy import select

    from db.models import Message, Summary

    p = make_project(chat, cls="public")
    conv = chat.post(f"/projects/{p['id']}/conversations", json={"title": "T"}).json()
    assert chat.post(f"/conversations/{conv['id']}/messages", json={"text": "hi"}).status_code < 300
    with db.session() as s:
        s.add(
            Summary(
                id="00000000-0000-4000-8000-0000000000aa",
                conversation_id=conv["id"],
                covers_until_message_id="x",
                content="summary",
                classification_effective="public",
                classification_source="project",
                model_id="m",
                provider="local",
            )
        )
        s.commit()
    chat.post(f"/projects/{p['id']}/reclassify", json={"to": "restricted"})
    with db.session() as s:
        classes = {m.classification_effective for m in s.scalars(select(Message))}
        classes |= {x.classification_effective for x in s.scalars(select(Summary))}
    assert classes == {"restricted"}
