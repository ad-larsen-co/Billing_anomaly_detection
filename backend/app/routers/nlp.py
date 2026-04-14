from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from app.database import session_scope
from app.exceptions import AppError
from app.schemas import NLPQueryIn, NLPQueryOut
from app.services.nlp_pipeline import hybrid_nlp_answer

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["nlp"])


@router.post("/nlp/query", response_model=NLPQueryOut)
def nlp_query(body: NLPQueryIn) -> NLPQueryOut:
    try:
        with session_scope() as session:
            result = hybrid_nlp_answer(session, body.question.strip())
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
