"""SPIKE-D04: POST /spike/v1/chat/completions, streamed as server-sent events.

Thin like aios_backend.routes: no sqlalchemy, DB driver, subprocess or raw network here.
"""

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from aios_backend.apps.spike import service
from aios_backend.apps.spike.schemas import ChatCompletionRequest
from aios_backend.engine import EngineError, EngineManager, NoModel

router = APIRouter(prefix="/spike", tags=["spike (temporary, D-04)"])


@router.post(
    "/v1/chat/completions",
    summary="TEMPORARY (D-04): stream one local answer; replaced by the gateway (G-01)",
    responses={409: {"description": "no_model"}, 503: {"description": "engine_failed"}},
)
async def chat_completions(body: ChatCompletionRequest, request: Request) -> StreamingResponse:
    manager: EngineManager = request.app.state.engine
    try:
        await service.start_engine(manager)  # errors map to 409/503 before streaming
    except NoModel:
        raise HTTPException(status_code=409, detail="no_model") from None
    except EngineError:
        raise HTTPException(status_code=503, detail="engine_failed") from None
    return StreamingResponse(
        service.stream_completion(manager, body),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store"},
    )
