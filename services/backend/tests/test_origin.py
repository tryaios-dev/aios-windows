"""AC-02: model files come from their origin on Hugging Face, through the network door, with resume."""

import hashlib
from pathlib import Path

import httpx
import pytest

from aios_backend.apps.models import catalogue
from aios_backend.apps.models.downloads import Downloads, Job
from aios_backend.net import HostNotAllowed
from aios_backend.origin import HuggingFaceOrigin, OriginError

FILE = bytes(range(256)) * 64  # 16 KiB stand-in for a model file
ORIGIN = "https://huggingface.co/org/model-GGUF/resolve/0123abcd/model.gguf"
CDN = "https://us.aws.cdn.hf.co/xet-bridge-us/abc/def?Expires=1"


def hugging_face(seen: list[httpx.Request]) -> httpx.MockTransport:
    """huggingface.co redirects to its CDN, which honours range requests."""

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.host == "huggingface.co":
            return httpx.Response(302, headers={"location": CDN})
        start = 0
        if "range" in request.headers:
            start = int(request.headers["range"].removeprefix("bytes=").rstrip("-"))
            return httpx.Response(206, content=FILE[start:])
        return httpx.Response(200, content=FILE)

    return httpx.MockTransport(handle)


def test_ac_02_a_download_follows_the_redirect_to_the_allowlisted_cdn() -> None:
    seen: list[httpx.Request] = []
    origin = HuggingFaceOrigin(transport=hugging_face(seen))
    assert b"".join(origin.fetch("e", ORIGIN, 0)) == FILE
    assert [r.url.host for r in seen] == ["huggingface.co", "us.aws.cdn.hf.co"]
    assert seen[0].headers["user-agent"] == "AIOS"  # nothing about the user or machine


def test_ac_02_resume_asks_only_for_the_missing_bytes() -> None:
    seen: list[httpx.Request] = []
    origin = HuggingFaceOrigin(transport=hugging_face(seen))
    assert b"".join(origin.fetch("e", ORIGIN, 1000)) == FILE[1000:]
    assert seen[-1].headers["range"] == "bytes=1000-"


def test_ac_02_an_origin_that_ignores_the_range_is_refused() -> None:
    """A full file sent from byte 0 would corrupt a resumed download."""
    origin = HuggingFaceOrigin(
        transport=httpx.MockTransport(lambda r: httpx.Response(200, content=FILE))
    )
    with pytest.raises(OriginError):
        list(origin.fetch("e", ORIGIN, 1000))


def test_ac_21_a_redirect_to_a_host_off_the_allowlist_is_never_sent() -> None:
    seen: list[str] = []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url.host))
        return httpx.Response(302, headers={"location": "https://files.elsewhere.test/model.gguf"})

    origin = HuggingFaceOrigin(transport=httpx.MockTransport(handle))
    with pytest.raises(HostNotAllowed):
        list(origin.fetch("e", ORIGIN, 0))
    assert seen == ["huggingface.co"]


def test_ac_02_an_interrupted_download_resumes_and_completes(tmp_path: Path) -> None:
    """The download manager with the real origin client: stop half-way, resume, file complete."""
    seen: list[httpx.Request] = []
    origin = HuggingFaceOrigin(transport=hugging_face(seen))
    part = tmp_path / "model.gguf.download"
    part.write_bytes(FILE[:5000])  # what an earlier, interrupted run left on disk
    installed: list[bytes] = []
    job = Job(entry_id="e", url=ORIGIN, part=part, total_bytes=len(FILE))
    Downloads().start(job, origin, lambda p: installed.append(p.read_bytes()))
    assert job.thread is not None
    job.thread.join(10)
    assert job.status == "done", job.error
    assert hashlib.sha256(installed[0]).hexdigest() == hashlib.sha256(FILE).hexdigest()
    assert seen[-1].headers["range"] == "bytes=5000-"


def test_every_catalogue_entry_downloads_from_an_allowlisted_origin() -> None:
    from aios_backend.net import Allowlist

    for entry in catalogue.entries():
        assert Allowlist().allows(entry.mirror_url), entry.id
