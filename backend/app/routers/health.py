from __future__ import annotations

import logging

from fastapi import APIRouter
from sqlalchemy import text

from app.database import get_engine
from app.schemas import HealthOut

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthOut)
def health() -> HealthOut:
    db_status = "ok"
    try:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as e:
        logger.warning("Health DB check failed: %s", e)
        db_status = f"error: {e}"

    return HealthOut(
        status="ok" if db_status == "ok" else "degraded",
        database=db_status,
        hf_space="configured",
    )
