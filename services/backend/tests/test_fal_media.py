"""Hunyuan Video, a linked video resource made over fal.ai's queue API.

The path is the one every media request takes: media app -> provider router -> gateway ->
``MediaSides`` -> ``FalMedia`` -> fal (invariant 1, PR-04). The key is in the key store only and
goes only to fal's queue host, never to the file host (invariant 3). Every video is allowed by the
person (Allow once, invariant 2). Nothing of the description reaches a log (invariant 6).

``FakeFal`` behaves like fal's queue (fal.ai/docs, model endpoints, queue): POST
``/{owner}/{app}``, GET ``.../requests/{id}/status``, GET ``.../requests/{id}``, PUT
``.../requests/{id}/cancel``, and the file on ``v3.fal.media``.
"""

import json
import logging
from collections.abc import Iterator

import httpx
import pytest
from fastapi.testclient import TestClient
from tests.conftest import LAUNCH_TOKEN, LOOPBACK, FakeAnswers

from aios_backend import linked_config, net
from aios_backend.apps.resources import service as resource_service
from aios_backend.config import Settings
from aios_backend.gateway.app import create_gateway_app
from aios_backend.main import create_app
from aios_backend.media import MediaError, MediaJob
from aios_backend.media.fal import JOB_PREFIX, FalMedia, MediaSides, check
from aios_backend.providers import ProviderRouter
from db.session import Database

RID = "hunyuan-video"
KEY = "fal-key-" + "b" * 32
REQUEST = "5f0c2a8e-1b2c-4d5e-8f90-123456789abc"
FILE = f"https://v3.fal.media/files/rabbit/{REQUEST}.mp4"
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"video-bytes" * 10
PROMPT = "a paper boat drifting down a rainy street"
VIDEO = {
    "kind": "video",
    "model": RID,
    "prompt": PROMPT,
    "width": 480,
    "height": 832,
    "frames": 33,
}


class FakeFal:
    """fal's queue for one endpoint. Each status request moves the request one step on."""

    def __init__(self) -> None:
        self.steps = ["IN_QUEUE", "IN_PROGRESS", "COMPLETED"]
        self.step = 0
        self.requests: list[httpx.Request] = []
        self.file_url = FILE
        self.failed = False
        self.cancelled = False

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        host, path = request.url.host, request.url.path
        if host == "v3.fal.media":
            return httpx.Response(200, content=MP4, headers={"content-type": "video/mp4"})
        if host != "queue.fal.run":
            return httpx.Response(404)
        if request.headers.get("authorization") != f"Key {KEY}":
            return httpx.Response(401, json={"detail": "unauthorized"})
        app = "/fal-ai/hunyuan-video"
        if path == app and request.method == "POST":
            return httpx.Response(200, json={"request_id": REQUEST, "queue_position": 2})
        if not path.startswith(f"{app}/requests/{REQUEST}"):
            return httpx.Response(404, json={"detail": "not found"})
        rest = path.removeprefix(f"{app}/requests/{REQUEST}")
        if rest == "/cancel" and request.method == "PUT":
            self.cancelled = True
            return httpx.Response(202, json={"status": "CANCELLATION_REQUESTED"})
        if rest == "/status":
            status = self.steps[min(self.step, len(self.steps) - 1)]
            self.step += 1
            body: dict[str, object] = {"status": status, "request_id": REQUEST}
            if status == "IN_QUEUE":
                body["queue_position"] = 1
            if status == "COMPLETED" and self.failed:
                body["error"] = "boom"
            return httpx.Response(200 if status == "COMPLETED" else 202, json=body)
        if rest == "":
            return httpx.Response(
                200,
                json={
                    "video": {
                        "url": self.file_url,
                        "content_type": "video/mp4",
                        "file_size": len(MP4),
                    },
                    "seed": 7,
                },
            )
        return httpx.Response(404)


@pytest.fixture
def fal() -> FakeFal:
    return FakeFal()


@pytest.fixture
def keystore(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    store: dict[str, str] = {}
    monkeypatch.setattr(linked_config, "get_secret", store.get)
    monkeypatch.setattr(linked_config, "set_secret", store.__setitem__)
    monkeypatch.setattr(linked_config, "delete_secret", store.pop)
    return store


def source(fal: FakeFal, key: str | None = KEY) -> FalMedia:
    return FalMedia(secret=lambda rid: key, transport=fal.transport)


def job(**changes: object) -> MediaJob:
    fields: dict[str, object] = {**VIDEO, "seed": 7}
    fields.update(changes)
    return MediaJob(**fields)  # type: ignore[arg-type]


# ------------------------------------------------------------------ the fal client
def test_hunyuan_is_offered_only_while_linked(fal: FakeFal) -> None:
    assert source(fal, key=None).media_models() == []
    assert [(m.id, m.kind) for m in source(fal).media_models()] == [(RID, "video")]
    assert fal.requests == [], "listing sends nothing"
    with pytest.raises(MediaError) as exc:
        source(fal, key=None).media_submit(job())
    assert exc.value.code == "resource_not_linked"
    assert fal.requests == []


def test_a_video_is_asked_of_fal_with_the_key_and_the_shape(fal: FakeFal) -> None:
    remote = source(fal).media_submit(job())
    assert remote.id == f"{JOB_PREFIX}{REQUEST}" and remote.status == "queued"
    assert remote.position == 2
    sent = fal.requests[0]
    assert str(sent.url) == "https://queue.fal.run/fal-ai/hunyuan-video"
    assert sent.headers["authorization"] == f"Key {KEY}"
    body = json.loads(sent.content)
    assert body["prompt"] == PROMPT and body["seed"] == 7 and body["aspect_ratio"] == "9:16"


def test_a_video_is_followed_to_its_file_without_sending_the_key_there(fal: FakeFal) -> None:
    media = source(fal)
    remote = media.media_submit(job())
    assert media.media_job(remote.id).status == "queued"
    assert media.media_job(remote.id).status == "running"
    done = media.media_job(remote.id)
    assert done.status == "done" and done.outputs[0].mime == "video/mp4"
    assert media.media_output(remote.id, 0) == (MP4, "video/mp4")
    download = fal.requests[-1]
    assert download.url.host == "v3.fal.media"
    assert "authorization" not in download.headers, "the key goes only to the queue host"


def test_a_file_off_fal_file_hosts_is_not_fetched(fal: FakeFal) -> None:
    fal.file_url = "https://evil.example/video.mp4"
    media = source(fal)
    remote = media.media_submit(job())
    for _ in range(2):
        media.media_job(remote.id)
    done = media.media_job(remote.id)
    assert done.status == "failed" and done.error_code == "media_no_output"
    assert all(r.url.host == "queue.fal.run" for r in fal.requests)


def test_a_failed_request_says_so(fal: FakeFal) -> None:
    fal.failed = True
    media = source(fal)
    remote = media.media_submit(job())
    for _ in range(2):
        media.media_job(remote.id)
    assert media.media_job(remote.id).status == "failed"


def test_a_video_can_be_cancelled_and_a_strange_job_id_is_refused(fal: FakeFal) -> None:
    media = source(fal)
    remote = media.media_submit(job())
    media.media_cancel(remote.id)
    assert fal.cancelled and fal.requests[-1].method == "PUT"
    with pytest.raises(MediaError) as exc:
        media.media_job("job_fal-../../x")
    assert exc.value.code == "media_job_not_found"


def test_the_key_is_checked_without_making_anything(fal: FakeFal) -> None:
    assert check(RID, KEY, transport=fal.transport) is None  # an unknown request: 404
    assert check(RID, "wrong-key-" + "c" * 20, transport=fal.transport) == "resource_key_rejected"
    assert all(r.method == "GET" for r in fal.requests)


def test_the_router_sends_each_job_to_its_side(fal: FakeFal) -> None:
    sides = MediaSides(None, source(fal))
    assert [m.id for m in sides.media_models()] == [RID]
    with pytest.raises(MediaError) as exc:
        sides.media_submit(job(model="wan2.1-t2v-1.3b"))
    assert exc.value.code == "media_unavailable"
    assert sides.media_submit(job()).id.startswith(JOB_PREFIX)


def test_the_allowlist_names_fal_hosts() -> None:
    rows = {host for fid, host, _, _, kind in net.ALLOWLIST if fid.startswith(f"linked-{RID}")}
    assert rows == {"queue.fal.run", *linked_config.FAL_FILE_HOSTS}
    assert linked_config.resource_of_flow(f"linked-{RID}-files-v3") == RID
    assert linked_config.resource_of_flow("linked-kimi-k2") == "kimi-k2"


# ------------------------------------------------------------------ the local API
@pytest.fixture
def api(
    settings: Settings, db: Database, fal: FakeFal, keystore: dict[str, str]
) -> Iterator[TestClient]:
    """No company server: only the linked video resource makes videos."""
    gateway_app = create_gateway_app(
        FakeAnswers(), None, MediaSides(None, FalMedia(transport=fal.transport))
    )
    with TestClient(gateway_app, client=LOOPBACK) as gateway:
        router = ProviderRouter(FakeAnswers(), "http://testserver", client=lambda: gateway)
        app = create_app(settings, db, FakeAnswers(), media=router)
        app.state.resource_check = lambda rid, key: None
        app.state.resource_models = None
        headers = {"Authorization": f"Bearer {LAUNCH_TOKEN}"}
        with TestClient(app, client=LOOPBACK, headers=headers) as c:
            yield c


def _project(api: TestClient) -> str:
    return str(api.post("/projects", json={"name": "P", "classification": "internal"}).json()["id"])


def _link(api: TestClient, limit: float | None = None) -> None:
    resp = api.post(f"/resources/{RID}/link", json={"api_key": KEY, "monthly_limit": limit})
    assert resp.status_code == 200, resp.text
    assert resp.json()["kind"] == "video"


def _follow(api: TestClient, media_id: str) -> dict[str, object]:
    for _ in range(3):
        item = api.get(f"/media/{media_id}").json()
    return dict(item)


def test_videos_need_hunyuan_linked(api: TestClient) -> None:
    status = api.get("/media/status").json()
    assert status["available"] is False and status["reason"] == "company_provider_disabled"
    resp = api.post(f"/projects/{_project(api)}/media", json={**VIDEO, "confirmed": True})
    assert resp.status_code == 409 and resp.json() == {"error": "resource_not_linked"}


def test_every_video_is_allowed_once(
    api: TestClient, fal: FakeFal, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    _link(api)
    status = api.get("/media/status").json()
    assert status["available"] is True and status["models"] == [{"id": RID, "kind": "video"}]
    pid = _project(api)
    for _ in range(2):  # it asks every time, not once per project
        resp = api.post(f"/projects/{pid}/media", json=VIDEO)
        assert resp.status_code == 400 and resp.json() == {"error": "confirmation_required"}
        resp = api.post(f"/projects/{pid}/media", json={**VIDEO, "confirmed": True})
        assert resp.status_code == 201, resp.text
    done = _follow(api, resp.json()["id"])
    assert done["status"] == "done" and done["mime"] == "video/mp4"
    evidence = api.get("/evidence").json()
    asked = [e for e in evidence if e["event_type"] == "media_requested"]
    assert asked and all(e["payload"]["provider"] == "resource" for e in asked)
    assert PROMPT not in caplog.text and KEY not in caplog.text


def test_usage_counts_seconds_and_the_limit_stops_videos(api: TestClient, db: Database) -> None:
    _link(api, limit=1.0)
    with db.session() as session:
        resource_service.set_price(session, RID, 0.5, None)  # per second of video
        session.commit()
    pid = _project(api)
    item = api.post(f"/projects/{pid}/media", json={**VIDEO, "confirmed": True}).json()
    _follow(api, item["id"])
    row = next(r for r in api.get("/resources").json() if r["id"] == RID)
    seconds = linked_config.VIDEO_SECONDS[RID]
    assert row["videos"] == 1 and row["uses"] == 1
    assert row["video_seconds"] == round(seconds, 1)
    assert row["spent"] == pytest.approx(seconds * 0.5)
    resp = api.post(f"/projects/{pid}/media", json={**VIDEO, "confirmed": True})
    assert resp.status_code == 409 and resp.json() == {"error": "resource_limit_reached"}
