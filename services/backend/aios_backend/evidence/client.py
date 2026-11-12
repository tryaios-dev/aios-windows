"""Calls to the evidence writer's API (IPC-42). Bearer token: derive(T, evidence-writer).

Requests carry content-free intents only: event type, time, ids, digests, counts, flags.
"""

import json
from typing import Any, Protocol

import httpx

WRITER_PURPOSE = "aios/ipc/v1/evidence-writer"
TIMEOUT_S = 10.0


class WriterUnavailable(Exception):
    """The writer did not answer, or refused. ``code`` is its error code, never content."""

    def __init__(self, code: str, status: int = 503) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


class WriterClient(Protocol):
    def status(self) -> dict[str, Any]: ...
    def init_stream(self, stream_id: str) -> dict[str, Any]: ...
    def append(self, intents: list[dict[str, Any]]) -> dict[str, Any]: ...
    def checkpoint(self) -> dict[str, Any]: ...
    def checkpoints(self, from_seq: int | None = None) -> list[dict[str, Any]]: ...
    def events(self, after_seq: int | None = None) -> list[dict[str, Any]]: ...
    def export(self, scope: dict[str, Any]) -> tuple[bytes, dict[str, Any]]: ...
    def backup(self, path: str) -> None: ...
    def restore(
        self, backup_path: str, stream_id: str, min_tip_seq: int | None
    ) -> dict[str, Any]: ...


class HttpWriterClient:
    """``http`` is any httpx.Client already pointed at the writer, with the bearer header set
    (tests pass the writer's own TestClient)."""

    def __init__(self, http: httpx.Client) -> None:
        self.http = http

    @classmethod
    def connect(cls, port: int, token: str) -> "HttpWriterClient":
        return cls(
            httpx.Client(
                base_url=f"http://127.0.0.1:{port}",
                headers={"Authorization": f"Bearer {token}"},
                timeout=TIMEOUT_S,
                trust_env=False,  # loopback never goes through a proxy
            )
        )

    def _call(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        try:
            resp = self.http.request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            raise WriterUnavailable("writer_unavailable") from exc
        if resp.status_code >= 400:
            try:
                code = str(resp.json().get("error", "writer_error"))
            except ValueError:
                code = "writer_error"
            raise WriterUnavailable(code, resp.status_code)
        return resp

    def status(self) -> dict[str, Any]:
        return dict(self._call("GET", "/status").json())

    def init_stream(self, stream_id: str) -> dict[str, Any]:
        return dict(self._call("POST", "/stream", json={"stream_id": stream_id}).json())

    def append(self, intents: list[dict[str, Any]]) -> dict[str, Any]:
        return dict(self._call("POST", "/intents", json={"intents": intents}).json())

    def checkpoint(self) -> dict[str, Any]:
        return dict(self._call("POST", "/checkpoint").json())

    def checkpoints(self, from_seq: int | None = None) -> list[dict[str, Any]]:
        params = {"from_seq": from_seq} if from_seq is not None else {}
        return list(self._call("GET", "/checkpoints", params=params).json()["checkpoints"])

    def events(self, after_seq: int | None = None) -> list[dict[str, Any]]:
        params = {"after_seq": after_seq} if after_seq is not None else {}
        return list(self._call("GET", "/events", params=params).json()["events"])

    def export(self, scope: dict[str, Any]) -> tuple[bytes, dict[str, Any]]:
        resp = self._call("POST", "/export", json={"scope": scope})
        return resp.content, dict(json.loads(resp.headers["x-aios-export"]))

    def backup(self, path: str) -> None:
        self._call("POST", "/backup", json={"path": path})

    def restore(self, backup_path: str, stream_id: str, min_tip_seq: int | None) -> dict[str, Any]:
        body = {"backup_path": backup_path, "stream_id": stream_id, "min_tip_seq": min_tip_seq}
        return dict(self._call("POST", "/restore", json=body).json())
