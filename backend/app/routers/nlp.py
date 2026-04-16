from __future__ import annotations

import json
import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app.database import session_scope
from app.exceptions import AppError
from app.schemas import NLPQueryIn, NLPQueryOut
from app.services.nlp_pipeline import hybrid_nlp_answer, stream_nlp_events

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["nlp"])


@router.post("/nlp/query", response_model=NLPQueryOut)
def nlp_query(body: NLPQueryIn) -> NLPQueryOut:
    try:
        with session_scope() as session:
            result = hybrid_nlp_answer(
                session, body.question.strip(), body.messages
            )
            return NLPQueryOut(
                intent=result["intent"],
                answer=result["answer"],
                sql_used=result.get("sql_used"),
                structured_rows=result.get("structured_rows"),
            )
    except AppError as e:
        raise HTTPException(status_code=502, detail=e.message) from e
    except Exception as e:
        logger.exception("nlp_query failed")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/nlp/query/stream")
def nlp_query_stream(body: NLPQueryIn) -> StreamingResponse:
    """SSE stream: JSON lines in `data: {...}` — meta, delta chunks, then done."""

    def gen():
        try:
            with session_scope() as session:
                for event in stream_nlp_events(
                    session, body.question.strip(), body.messages
                ):
                    yield f"data: {json.dumps(event)}\n\n"
                yield f"data: {json.dumps({'done': True})}\n\n"
        except AppError as e:
            yield f"data: {json.dumps({'error': e.message})}\n\n"
        except Exception as e:
            logger.exception("nlp_query_stream failed")
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
