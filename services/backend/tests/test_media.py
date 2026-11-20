"""R-7: pictures and videos made on the company's GPU server.

The path is the same as chat's: media app -> provider router -> gateway -> company media client ->
the server's media service (invariant 1, PR-04). The description leaves the computer, so the
Company rule applies (invariant 2, PR-03). The API key stays in the key store (invariant 3), and
neither the description nor the file reaches a log or evidence (invariant 6).

``FakeMediaServer`` behaves like the media service on the GPU server (docs: REPORT-media-setup):
``/v1/media/models``, ``/jobs``, ``/jobs/{id}``, ``/jobs/{id}/outputs/{i}``, DELETE ``/jobs/{id}``.
"""

import base64
import dataclasses
import json
import logging
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from tests.conftest import LAUNCH_TOKEN, LOOPBACK, FakeAnswers

from aios_backend.config import Settings
from aios_backend.gateway.app import GATEWAY_PURPOSE, create_gateway_app
from aios_backend.main import create_app
from aios_backend.media import MediaError, MediaJob, RemoteJob, check_job
from aios_backend.media.company import CompanyMedia
from aios_backend.providers import ProviderRouter
from aios_common.handshake import derive
from db.session import Database

BASE = "https://ai.company.test"
KEY = "0123456789abcdef" * 4
PNG = b"\x89PNG\r\n\x1a\n" + b"picture-bytes" * 10
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"video-bytes" * 10
PROMPT = "a lighthouse at sunset, oil painting"
IMAGE = {"kind": "image", "model": "flux-schnell", "prompt": PROMPT, "width": 1024, "height": 1024}
VIDEO = {
    "kind": "video",
    "model": "wan2.1-t2v-1.3b",
    "prompt": PROMPT,
    "width": 832,
    "height": 480,
    "frames": 33,
}


class FakeMediaServer:
    """The GPU server's media service. Each status request moves a job one step along ``steps``."""

    def __init__(self) -> None:
        self.models = [
            {"id": "sdxl-lightning", "kind": "image"},
            {"id": "flux-schnell", "kind": "image"},
            {"id": "wan2.1-t2v-1.3b", "kind": "video"},
        ]
        self.steps = ["queued", "running", "done"]
        self.jobs: dict[str, dict[str, object]] = {}
        self.requests: list[httpx.Request] = []
        self.offline = False
        self.no_media = False
        self.refuse: tuple[int, str] | None = None
        self.redirect: str | None = None
        self.error_code = "out_of_memory"
        self.output_mime: str | None = None

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.offline:
            raise httpx.ConnectError("no route", request=request)
        if self.redirect:
            return httpx.Response(302, headers={"location": self.redirect})
        path = request.url.path
        if self.no_media or not path.startswith("/v1/media/"):
            return httpx.Response(404)
        if request.headers.get("authorization") != f"Bearer {KEY}":
            return httpx.Response(401, json={"error": {"code": "unauthorized"}})
        parts = path.removeprefix("/v1/media/").split("/")
        if parts == ["models"]:
            return httpx.Response(200, json={"data": self.models})
        if parts == ["jobs"] and request.method == "POST":
            if self.refuse:
                status, code = self.refuse
                return httpx.Response(status, json={"error": {"code": code}})
            body = json.loads(request.content)
            job_id = f"job_{len(self.jobs) + 1:04d}"
            self.jobs[job_id] = {"body": body, "step": 0, "cancelled": False}
            return httpx.Response(202, json={"id": job_id, "status": "queued", "position": 0})
        job = self.jobs.get(parts[1]) if len(parts) >= 2 and parts[0] == "jobs" else None
        if job is None:
            return httpx.Response(404, json={"error": {"code": "not_found"}})
        if len(parts) == 2 and request.method == "DELETE":
            job["cancelled"] = True
            return httpx.Response(200, json={"id": parts[1], "status": "cancelled"})
        if len(parts) == 2:
            return httpx.Response(200, json=self._status(parts[1], job))
        if len(parts) == 4 and parts[2] == "outputs" and parts[3] == "0":
            video = job["body"]["kind"] == "video"  # type: ignore[index]
            mime = self.output_mime or ("video/mp4" if video else "image/png")
            return httpx.Response(
                200, content=MP4 if video else PNG, headers={"content-type": mime}
            )
        return httpx.Response(404)

    def _status(self, job_id: str, job: dict[str, object]) -> dict[str, object]:
        if job["cancelled"]:
            return {"id": job_id, "status": "cancelled", "progress": 0.0, "outputs": []}
        step = min(int(job["step"]), len(self.steps) - 1)  # type: ignore[call-overload]
        job["step"] = step + 1
        status = self.steps[step]
        out: dict[str, object] = {
            "id": job_id,
            "status": status,
            "progress": {"queued": 0.0, "running": 0.5}.get(status, 1.0),
            "position": 0 if status == "queued" else None,
            "outputs": [],
            "error": None,
        }
        if status == "done":
            video = job["body"]["kind"] == "video"  # type: ignore[index]
            mime = "video/mp4" if video else "image/png"
            out["outputs"] = [{"index": 0, "mime": mime, "bytes": len(MP4 if video else PNG)}]
        if status == "failed":
            out["error"] = {"code": self.error_code}
        return out


@pytest.fixture
def server() -> FakeMediaServer:
    return FakeMediaServer()


@pytest.fixture
def company_settings(settings: Settings) -> Settings:
    return dataclasses.replace(
        settings, company_ai=True, company_base_url=BASE, company_model_name="gemma-4-26b-a4b"
    )


def media_client(
    settings: Settings, server: FakeMediaServer, key: str | None = KEY
) -> CompanyMedia:
    return CompanyMedia.from_settings(settings, secret=lambda: key, transport=server.transport)


def job(**changes: object) -> MediaJob:
    fields: dict[str, object] = {**IMAGE, "seed": 7}
    fields.update(changes)
    return MediaJob(**fields)  # type: ignore[arg-type]


# ------------------------------------------------------------------ what may be asked for
@pytest.mark.parametrize(
    ("changes", "code"),
    [
        ({"width": 1000, "height": 512}, "invalid_size"),
        ({"prompt": "   "}, "invalid_prompt"),
        ({"prompt": "x" * 2001}, "invalid_prompt"),
        ({"negative_prompt": "x" * 1001}, "negative_prompt_too_long"),
        ({"seed": -1}, "invalid_seed"),
        ({"seed": 2**32}, "invalid_seed"),
        ({"model": "org/model"}, "unknown_model"),
        ({"frames": 33}, "invalid_frames"),  # frames on a picture
        ({"kind": "video", "width": 832, "height": 480, "frames": 18}, "invalid_frames"),
        ({"kind": "video", "width": 832, "height": 480, "frames": 85}, "invalid_frames"),
        ({"kind": "video", "width": 1024, "height": 1024, "frames": 33}, "invalid_size"),
    ],
)
def test_r7_a_request_the_server_would_refuse_is_refused_here(
    changes: dict[str, object], code: str
) -> None:
    with pytest.raises(MediaError) as exc:
        check_job(job(**changes))
    assert exc.value.code == code and exc.value.status == 400


def test_r7_valid_requests_pass() -> None:
    check_job(job())
    check_job(job(kind="video", width=480, height=832, frames=81, model="wan2.1-t2v-1.3b"))


@pytest.mark.parametrize(
    "answer",
    [
        {"id": "../../llm/api-key.txt", "status": "done"},
        {"id": "job_1", "status": "exploded"},
        {"id": "job_1", "status": "done", "outputs": [{"index": 99, "mime": "image/png"}]},
        {"id": "job_1", "status": "done", "outputs": [{"index": 0, "mime": "text/html"}]},
        ["not", "an", "object"],
    ],
)
def test_r7_a_strange_answer_from_the_server_is_refused(answer: object) -> None:
    """The job id ends up in a URL path and the type decides how a file is shown."""
    with pytest.raises(MediaError) as exc:
        RemoteJob.from_json(answer)
    assert exc.value.code == "media_bad_answer"


# ------------------------------------------------------------------ the company media client
def test_r7_models_come_from_the_media_service_on_the_company_host(
    company_settings: Settings, server: FakeMediaServer
) -> None:
    # The chat address may carry a path (/v1); the media service is at the host's /v1/media.
    settings = dataclasses.replace(company_settings, company_base_url=f"{BASE}/v1")
    models = media_client(settings, server).media_models()
    assert [m.id for m in models] == ["sdxl-lightning", "flux-schnell", "wan2.1-t2v-1.3b"]
    [request] = server.requests
    assert str(request.url) == f"{BASE}/v1/media/models"
    assert request.headers["authorization"] == f"Bearer {KEY}"


def test_r7_nothing_is_sent_while_company_is_off_or_without_a_key(
    settings: Settings, company_settings: Settings, server: FakeMediaServer
) -> None:
    with pytest.raises(MediaError) as off:
        media_client(settings, server).media_models()
    with pytest.raises(MediaError) as no_key:
        media_client(company_settings, server, key=None).media_submit(job())
    assert off.value.code == "media_unavailable"
    assert no_key.value.code == "company_key_missing"
    assert server.requests == []


@pytest.mark.parametrize(
    ("setup", "code", "status"),
    [
        (lambda s: setattr(s, "offline", True), "media_unreachable", 503),
        (lambda s: setattr(s, "no_media", True), "media_not_offered", 503),
        (lambda s: setattr(s, "refuse", (429, "queue_full")), "media_busy", 429),
        (lambda s: setattr(s, "refuse", (400, "unknown_model")), "unknown_model", 400),
        (lambda s: setattr(s, "refuse", (400, "Some <html> text")), "media_refused", 400),
    ],
)
def test_r7_server_refusals_become_short_codes(
    company_settings: Settings, server: FakeMediaServer, setup: object, code: str, status: int
) -> None:
    setup(server)  # type: ignore[operator]
    with pytest.raises(MediaError) as exc:
        media_client(company_settings, server).media_submit(job())
    assert (exc.value.code, exc.value.status) == (code, status)


def test_r7_a_wrong_key_is_reported_without_the_key(
    company_settings: Settings, server: FakeMediaServer, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO, logger="aios"), pytest.raises(MediaError) as exc:
        media_client(company_settings, server, key="wrong-key-0000000000").media_models()
    assert exc.value.code == "company_key_rejected"
    assert "wrong-key" not in caplog.text


def test_r7_the_server_is_reached_only_at_its_configured_address(
    company_settings: Settings, server: FakeMediaServer
) -> None:
    server.redirect = "https://somewhere.else.test/v1/media/models"
    with pytest.raises(MediaError) as exc:
        media_client(company_settings, server).media_models()
    assert exc.value.code == "media_unreachable"
    assert [r.url.host for r in server.requests] == ["ai.company.test"]


def test_r7_a_job_is_followed_to_its_file(
    company_settings: Settings, server: FakeMediaServer, caplog: pytest.LogCaptureFixture
) -> None:
    client = media_client(company_settings, server)
    with caplog.at_level(logging.INFO, logger="aios"):
        remote = client.media_submit(job(negative_prompt="blurry"))
        assert remote.status == "queued"
        assert client.media_job(remote.id).status == "queued"
        assert client.media_job(remote.id).status == "running"
        done = client.media_job(remote.id)
        assert done.status == "done" and done.outputs[0].mime == "image/png"
        assert client.media_output(remote.id, 0) == (PNG, "image/png")
    sent = json.loads(server.requests[0].content)
    assert sent == {**IMAGE, "seed": 7, "negative_prompt": "blurry"}
    assert PROMPT not in caplog.text and KEY not in caplog.text


def test_r7_an_output_of_an_unexpected_type_is_refused(
    company_settings: Settings, server: FakeMediaServer
) -> None:
    server.output_mime = "text/html"
    client = media_client(company_settings, server)
    remote = client.media_submit(job())
    with pytest.raises(MediaError) as exc:
        client.media_output(remote.id, 0)
    assert exc.value.code == "media_bad_answer"


# ------------------------------------------------------------------ router -> gateway -> client
@pytest.fixture
def gateway(company_settings: Settings, server: FakeMediaServer) -> Iterator[TestClient]:
    app = create_gateway_app(FakeAnswers(), None, media_client(company_settings, server))
    with TestClient(app, client=LOOPBACK) as c:
        yield c


def router(gateway: TestClient) -> ProviderRouter:
    return ProviderRouter(FakeAnswers(), "http://testserver", client=lambda: gateway)


def gateway_auth() -> dict[str, str]:
    return {"Authorization": f"Bearer {derive(GATEWAY_PURPOSE)}"}


def test_r7_media_requests_go_through_the_gateway(
    gateway: TestClient, server: FakeMediaServer
) -> None:
    r = router(gateway)
    assert [m.kind for m in r.media_models()] == ["image", "image", "video"]
    remote = r.media_submit(job(kind="video", **{k: VIDEO[k] for k in VIDEO if k != "kind"}))
    for _ in range(3):
        last = r.media_job(remote.id)
    assert last.status == "done"
    assert r.media_output(remote.id, 0) == (MP4, "video/mp4")
    r.media_cancel(remote.id)
    assert server.jobs[remote.id]["cancelled"] is True


def test_r7_the_gateway_needs_its_token_and_checks_requests(gateway: TestClient) -> None:
    assert gateway.get("/v1/media/models").status_code == 401
    bad = gateway.post(
        "/v1/media/jobs", json={**IMAGE, "seed": 1, "workflow": {}}, headers=gateway_auth()
    )
    assert bad.status_code == 422  # a workflow or any other field never reaches the server
    wrong = gateway.post(
        "/v1/media/jobs", json={**IMAGE, "seed": 1, "width": 1000}, headers=gateway_auth()
    )
    assert wrong.status_code == 400 and wrong.json() == {"error": "invalid_size"}


def test_r7_without_a_media_side_the_gateway_answers_unavailable() -> None:
    with TestClient(create_gateway_app(FakeAnswers()), client=LOOPBACK) as gw:
        resp = gw.get("/v1/media/models", headers=gateway_auth())
    assert resp.status_code == 503 and resp.json() == {"error": "media_unavailable"}
    with pytest.raises(MediaError) as exc:
        router(gw).media_models()
    assert exc.value.code == "media_unavailable"


# ------------------------------------------------------------------ the local API
@pytest.fixture
def api(company_settings: Settings, db: Database, gateway: TestClient) -> Iterator[TestClient]:
    """The app as backend.exe runs it: media requests through the router and the gateway."""
    app = create_app(company_settings, db, FakeAnswers(), media=router(gateway))
    headers = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}
    with TestClient(app, client=LOOPBACK, headers=headers) as c:
        yield c


def new_project(api: TestClient, company: bool = False) -> str:
    project = api.post("/projects", json={"name": "P", "classification": "internal"}).json()
    if company:
        resp = api.put(
            f"/projects/{project['id']}/company-ai", json={"enabled": True, "confirmed": True}
        )
        assert resp.status_code == 200, resp.text
    return str(project["id"])


def events(api: TestClient) -> list[dict[str, object]]:
    return list(api.get("/evidence").json())


def follow(api: TestClient, media_id: str, times: int = 3) -> dict[str, object]:
    for _ in range(times):
        item = api.get(f"/media/{media_id}").json()
    return dict(item)


def test_r7_status_says_what_can_be_made(api: TestClient, server: FakeMediaServer) -> None:
    status = api.get("/media/status").json()
    assert status["available"] is True and status["reason"] is None
    assert {m["id"]: m["kind"] for m in status["models"]}["wan2.1-t2v-1.3b"] == "video"


def test_r7_status_without_a_company_server(settings: Settings, db: Database) -> None:
    headers = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}
    with TestClient(create_app(settings, db), client=LOOPBACK, headers=headers) as api:
        status = api.get("/media/status").json()
        assert status == {"available": False, "reason": "company_provider_disabled", "models": []}
        pid = api.post("/projects", json={"name": "P", "classification": "internal"}).json()["id"]
        resp = api.post(f"/projects/{pid}/media", json={**IMAGE, "confirmed": True})
        assert resp.status_code == 409 and resp.json() == {"error": "company_provider_disabled"}


def test_r7_making_a_picture_asks_first(api: TestClient, server: FakeMediaServer) -> None:
    pid = new_project(api)
    resp = api.post(f"/projects/{pid}/media", json=IMAGE)
    assert resp.status_code == 400 and resp.json() == {"error": "confirmation_required"}
    assert not [r for r in server.requests if r.method == "POST"], "nothing left the computer"
    resp = api.post(f"/projects/{pid}/media", json={**IMAGE, "confirmed": True})
    assert resp.status_code == 201, resp.text
    item = resp.json()
    assert item["status"] == "queued" and item["prompt"] == PROMPT
    types = [e["event_type"] for e in events(api)]
    assert "disclosure_confirmed" in types and "media_requested" in types


def test_r7_a_project_using_the_company_server_does_not_ask_again(
    api: TestClient,
) -> None:
    pid = new_project(api, company=True)
    resp = api.post(f"/projects/{pid}/media", json=IMAGE)
    assert resp.status_code == 201, resp.text


def test_r7_a_picture_is_followed_kept_and_shown(api: TestClient) -> None:
    pid = new_project(api, company=True)
    item = api.post(f"/projects/{pid}/media", json=IMAGE).json()
    assert api.get(f"/media/{item['id']}/content").status_code == 409  # not ready yet
    running = api.get(f"/media/{item['id']}").json()
    assert running["status"] in ("queued", "running")
    done = follow(api, item["id"])
    assert done["status"] == "done" and done["mime"] == "image/png"
    assert done["size_bytes"] == len(PNG) and done["progress"] == 1.0
    content = api.get(f"/media/{item['id']}/content").json()
    assert content["mime"] == "image/png" and base64.b64decode(content["data_base64"]) == PNG
    listed = api.get(f"/projects/{pid}/media").json()
    assert [i["id"] for i in listed] == [item["id"]]
    completed = [e for e in events(api) if e["event_type"] == "media_completed"]
    assert len(completed) == 1, "one event when the job ends, not one per check"


def test_r7_a_video_is_kept_as_mp4(api: TestClient) -> None:
    pid = new_project(api, company=True)
    item = api.post(f"/projects/{pid}/media", json=VIDEO).json()
    done = follow(api, item["id"])
    assert done["status"] == "done" and done["mime"] == "video/mp4" and done["frames"] == 33


def test_r7_the_list_follows_running_jobs(api: TestClient) -> None:
    pid = new_project(api, company=True)
    item = api.post(f"/projects/{pid}/media", json=IMAGE).json()
    for _ in range(3):
        listed = api.get(f"/projects/{pid}/media").json()
    assert listed[0]["id"] == item["id"] and listed[0]["status"] == "done"


def test_r7_a_failed_job_says_why(api: TestClient, server: FakeMediaServer) -> None:
    server.steps = ["running", "failed"]
    pid = new_project(api, company=True)
    item = api.post(f"/projects/{pid}/media", json=IMAGE).json()
    failed = follow(api, item["id"])
    assert failed["status"] == "failed" and failed["error_code"] == "out_of_memory"


def test_r7_a_job_the_server_no_longer_has_is_expired(
    api: TestClient, server: FakeMediaServer
) -> None:
    pid = new_project(api, company=True)
    item = api.post(f"/projects/{pid}/media", json=IMAGE).json()
    server.jobs.clear()  # deleted on the server an hour after it ended
    gone = api.get(f"/media/{item['id']}").json()
    assert gone["status"] == "failed" and gone["error_code"] == "media_expired"


def test_r7_an_unreachable_server_leaves_the_job_waiting(
    api: TestClient, server: FakeMediaServer
) -> None:
    pid = new_project(api, company=True)
    item = api.post(f"/projects/{pid}/media", json=IMAGE).json()
    server.offline = True
    assert api.get(f"/media/{item['id']}").json()["status"] == "queued"
    server.offline = False
    assert follow(api, item["id"])["status"] == "done"


def test_r7_a_job_can_be_cancelled(api: TestClient, server: FakeMediaServer) -> None:
    pid = new_project(api, company=True)
    item = api.post(f"/projects/{pid}/media", json=VIDEO).json()
    cancelled = api.post(f"/media/{item['id']}/cancel").json()
    assert cancelled["status"] == "cancelled"
    assert server.jobs["job_0001"]["cancelled"] is True  # the server stopped too


def test_r7_a_picture_can_be_saved_and_deleted(api: TestClient, tmp_path: Path) -> None:
    pid = new_project(api, company=True)
    item = api.post(f"/projects/{pid}/media", json=IMAGE).json()
    follow(api, item["id"])
    saved = api.post(f"/media/{item['id']}/save", json={"path": str(tmp_path / "lighthouse")})
    assert saved.status_code == 200, saved.text
    assert Path(saved.json()["path"]).name == "lighthouse.png"
    assert (tmp_path / "lighthouse.png").read_bytes() == PNG
    relative = api.post(f"/media/{item['id']}/save", json={"path": "lighthouse.png"})
    assert relative.status_code == 400 and relative.json() == {"error": "invalid_path"}
    assert api.delete(f"/media/{item['id']}").status_code == 204
    assert api.get(f"/media/{item['id']}").status_code == 404
    types = [e["event_type"] for e in events(api)]
    assert "media_exported" in types and "media_deleted" in types


def test_r7_deleting_a_project_deletes_its_pictures(api: TestClient) -> None:
    pid = new_project(api, company=True)
    item = api.post(f"/projects/{pid}/media", json=IMAGE).json()
    assert api.delete(f"/projects/{pid}").status_code == 204
    assert api.get(f"/media/{item['id']}").status_code == 404


def test_r7_evidence_and_logs_hold_no_description(
    api: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO, logger="aios"):
        pid = new_project(api)
        item = api.post(f"/projects/{pid}/media", json={**VIDEO, "confirmed": True}).json()
        follow(api, item["id"])
    recorded = json.dumps(events(api))
    assert "lighthouse" not in recorded and "lighthouse" not in caplog.text
    assert KEY not in recorded and KEY not in caplog.text
    requested = next(e for e in events(api) if e["event_type"] == "media_requested")
    assert requested["payload"]["model"] == "wan2.1-t2v-1.3b"  # type: ignore[index]


def test_r7_unknown_fields_are_refused(api: TestClient) -> None:
    pid = new_project(api, company=True)
    resp = api.post(f"/projects/{pid}/media", json={**IMAGE, "workflow": {"1": {}}})
    assert resp.status_code == 422
