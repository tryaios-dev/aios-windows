"""L-02 security suite v2: content scans of logs, the support bundle and the evidence export.

A canary that cannot occur by chance is put in everything a person types or adds: a project
name, a question, the model's answer, a document and its file name. After a full session the
canary must not appear in any log line (SR-07), in the support bundle (logs only) or in the
evidence export (commitments and ids only, AC-20). The recovery key must not appear either.
"""

import dataclasses
import logging
import zipfile
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from tests.conftest import LAUNCH_TOKEN, LOOPBACK, FakeAnswers
from tests.test_evidence_writer import WRITER_TOKEN, FlakyWriter

from aios_backend.config import Settings
from aios_backend.evidence.client import HttpWriterClient
from aios_backend.main import configure_logging, create_app
from aios_evidence_writer.app import create_app as create_writer_app
from aios_evidence_writer.keys import MemoryKeys
from aios_evidence_writer.store import EvidenceStore
from db.session import Database

CANARY = "zq7canaryXK41"


@pytest.fixture
def logged(settings: Settings, tmp_path: Path) -> Iterator[Settings]:
    """The settings with a real log file, configured as backend.exe configures it."""
    logs = tmp_path / "logs"
    logs.mkdir()
    with_log = dataclasses.replace(settings, log_file=logs / "backend.log")
    saved = {
        n: (logging.getLogger(n).handlers, logging.getLogger(n).propagate)
        for n in ("aios", "uvicorn.error", "alembic")
    }
    configure_logging(with_log)
    yield with_log
    for name, (handlers, propagate) in saved.items():
        logger = logging.getLogger(name)
        for h in logger.handlers:
            h.close()
        logger.handlers, logger.propagate = handlers, propagate


@pytest.fixture
def session_client(logged: Settings, db: Database, tmp_path: Path) -> Iterator[TestClient]:
    store = EvidenceStore(tmp_path / "writer" / "evidence.db", MemoryKeys())
    answers = FakeAnswers(f"Here is the answer about {CANARY} you asked for.")
    with TestClient(
        create_writer_app(store, WRITER_TOKEN.encode()),
        client=LOOPBACK,
        headers={"Authorization": f"Bearer {WRITER_TOKEN}"},
    ) as http:
        writer = FlakyWriter(HttpWriterClient(http))
        app = create_app(logged, db, answers, writer=writer)  # type: ignore[arg-type]
        headers = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}
        with TestClient(app, client=LOOPBACK, headers=headers) as c:
            yield c
    store.close()


def _zip_bytes(path: Path) -> bytes:
    with zipfile.ZipFile(path) as z:
        return b"".join(z.read(n) + n.encode() for n in z.namelist())


def test_l02_no_content_in_logs_support_bundle_or_evidence_export(
    session_client: TestClient, logged: Settings, tmp_path: Path
) -> None:
    c = session_client
    created = c.post("/setup/store")
    assert created.status_code == 201
    recovery_key = created.json()["recovery_key"]
    assert c.post("/setup/complete").status_code == 200

    project = c.post(
        "/projects", json={"name": f"Project {CANARY}", "classification": "internal"}
    ).json()
    conv = c.post(f"/projects/{project['id']}/conversations", json={}).json()
    doc = tmp_path / f"notes {CANARY}.txt"
    doc.write_text(f"The document says {CANARY} twice: {CANARY}.", encoding="utf-8")
    added = c.post("/knowledge", json={"paths": [str(doc)]})
    assert added.status_code == 200, added.text
    sent = c.post(
        f"/conversations/{conv['id']}/messages",
        json={"text": f"Tell me about {CANARY}", "knowledge_ids": [added.json()[0]["id"]]},
    )
    assert sent.status_code in (200, 201), sent.text
    # A refused request and an error path must not echo content into the log either.
    c.post("/projects", json={"name": CANARY * 100, "classification": "nonsense"})

    export = tmp_path / "evidence.zip"
    body = {"scope": "project", "project_id": project["id"], "path": str(export), "confirmed": True}
    assert c.post("/evidence/export", json=body).status_code == 201

    bundle_dir = tmp_path / "bundle"
    bundle_dir.mkdir()
    made = c.post("/system/support-bundle", json={"path": str(bundle_dir)})
    assert made.status_code == 201, made.text
    bundle = Path(made.json()["path"])

    for handler in logging.getLogger("aios").handlers:
        handler.flush()
    logs = b"".join(p.read_bytes() for p in logged.log_file.parent.iterdir() if p.is_file())  # type: ignore[union-attr]
    assert logs, "the session wrote no log lines: the scan would prove nothing"

    for name, data in (
        ("log files", logs),
        ("support bundle", _zip_bytes(bundle)),
        ("evidence export", _zip_bytes(export)),
    ):
        assert CANARY.encode() not in data, f"content found in the {name}"
        assert recovery_key.encode() not in data, f"the recovery key found in the {name}"
