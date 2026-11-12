"""The writer's API (IPC-42): loopback only, ``Authorization: Bearer derive(T, evidence-writer)``.

Only the backend can compute that token, so the writer refuses every other caller, including
Electron main and the renderer (IPC-41). No public paths, no docs pages. Error bodies are a code
only and never echo what was sent.
"""

import json
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from aios_common.asgi_auth import LoopbackTokenMiddleware
from aios_common.logging import get_logger, log_event
from aios_evidence_writer.store import EvidenceStore, Intent, WriterError

log = get_logger("evidence")

ID = Field(pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StreamIn(Strict):
    stream_id: str = ID


class IntentIn(Strict):
    intent_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_.:-]+$")
    type: str = Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")
    time: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
    body: dict[str, Any]
    project_id: str | None = None
    conversation_id: str | None = None


class IntentsIn(Strict):
    intents: list[IntentIn] = Field(min_length=1, max_length=500)


class ScopeIn(Strict):
    kind: Literal["project", "date_range", "stream"]
    project_id: str | None = None
    from_: str | None = Field(default=None, alias="from")
    to: str | None = None


class ExportIn(Strict):
    scope: ScopeIn
    export_id: str | None = None


class BackupIn(Strict):
    path: str


class RestoreIn(Strict):
    backup_path: str  # the backed-up data folder (or the file itself)
    stream_id: str = ID
    min_tip_seq: int | None = Field(default=None, ge=0)


def create_app(store: EvidenceStore, expected_token: bytes | None = None) -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(LoopbackTokenMiddleware, expected=lambda: expected_token)

    @app.exception_handler(WriterError)
    async def _refused(request: Request, exc: WriterError) -> JSONResponse:
        log_event(log, "request_refused", error_code=exc.code, status=exc.status)
        return JSONResponse({"error": exc.code}, status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def _invalid(request: Request, exc: RequestValidationError) -> JSONResponse:
        log_event(log, "request_refused", error_code="invalid_request", status=422)
        return JSONResponse({"error": "invalid_request"}, status_code=422)

    @app.get("/status")
    def status() -> dict[str, Any]:
        return store.status()

    @app.post("/stream")
    def init_stream(body: StreamIn) -> dict[str, Any]:
        store.init_stream(body.stream_id)
        return store.status()

    @app.post("/intents")
    def append(body: IntentsIn) -> dict[str, Any]:
        receipts = store.append(
            [
                Intent(i.intent_id, i.type, i.time, i.body, i.project_id, i.conversation_id)
                for i in body.intents
            ]
        )
        log_event(log, "appended", count=len(receipts))
        return {"receipts": [r.__dict__ for r in receipts], "status": store.status()}

    @app.post("/checkpoint")
    def checkpoint() -> dict[str, Any]:
        return {"checkpoint": store.checkpoint(), "status": store.status()}

    @app.get("/events")
    def events(
        project_id: str | None = None,
        since: str | None = None,
        until: str | None = None,
        after_seq: int | None = None,
        limit: int = 1000,
    ) -> dict[str, Any]:
        return {"events": store.events(project_id, since, until, after_seq, limit)}

    @app.get("/checkpoints")
    def checkpoints(from_seq: int | None = None, to_seq: int | None = None) -> dict[str, Any]:
        return {"checkpoints": store.checkpoints(from_seq, to_seq)}

    @app.post("/export")
    def export(body: ExportIn) -> Response:
        scope: dict[str, Any] = {"kind": body.scope.kind}
        if body.scope.kind == "project":
            if body.scope.project_id is None:
                raise WriterError("invalid_scope", 422)
            scope["project_id"] = body.scope.project_id
        if body.scope.kind == "date_range":
            if body.scope.from_ is None or body.scope.to is None:
                raise WriterError("invalid_scope", 422)
            scope["from"], scope["to"] = body.scope.from_, body.scope.to
        bundle, info = store.export(scope, body.export_id)
        log_event(log, "exported", count=info["event_count"])
        return Response(
            bundle, media_type="application/zip", headers={"x-aios-export": json.dumps(info)}
        )

    @app.post("/backup")
    def backup(body: BackupIn) -> dict[str, Any]:
        target = Path(body.path)
        if not target.is_absolute():
            raise WriterError("invalid_path", 400)
        store.backup_to(target)
        return {"ok": True}

    @app.post("/restore")
    def restore(body: RestoreIn) -> dict[str, Any]:
        result = store.restore(Path(body.backup_path), body.stream_id, body.min_tip_seq)
        log_event(log, "restored", epoch=result["epoch"])
        return result

    return app
