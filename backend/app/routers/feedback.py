from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from app.database import session_scope
from app.exceptions import AppError
from app.schemas import FeedbackIn, FeedbackListItem, FeedbackOut
from app.services.feedback_list import list_feedback_with_anomaly
from app.services.feedback_service import record_feedback

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["feedback"])


@router.get("/feedback", response_model=list[FeedbackListItem])
def get_feedback(limit: int = 50) -> list[FeedbackListItem]:
    try:
        with session_scope() as session:
            rows = list_feedback_with_anomaly(session, limit)
            return [
                FeedbackListItem(
                    id=fb.id,
                    anomaly_id=fb.anomaly_id,
                    order_id=order_id,
                    action=fb.action,
                    notes=fb.notes,
                    created_at=fb.created_at,
                )
                for fb, order_id in rows
            ]
    except Exception as e:
        logger.exception("get_feedback failed")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/feedback", response_model=FeedbackOut)
def post_feedback(body: FeedbackIn) -> FeedbackOut:
    try:
        with session_scope() as session:
            fb = record_feedback(
                session,
                body.anomaly_id,
                body.action,
                body.notes,
            )
            return FeedbackOut(
                id=fb.id,
                anomaly_id=fb.anomaly_id,
                action=fb.action,
                notes=fb.notes,
                created_at=fb.created_at,
            )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except AppError as e:
        raise HTTPException(status_code=500, detail=e.message) from e
    except Exception as e:
        logger.exception("post_feedback failed")
        raise HTTPException(status_code=500, detail=str(e)) from e
