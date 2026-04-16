from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.orm import AnomalyRecord, FeedbackEntry


def list_feedback_with_anomaly(
    session: Session, limit: int
) -> list[tuple[FeedbackEntry, str | None]]:
    """Return feedback rows with order_id from joined anomaly (newest first)."""
    cap = min(max(limit, 1), 500)
    stmt = (
        select(FeedbackEntry, AnomalyRecord.order_id)
        .join(AnomalyRecord, FeedbackEntry.anomaly_id == AnomalyRecord.id)
        .order_by(FeedbackEntry.created_at.desc())
        .limit(cap)
    )
    return list(session.execute(stmt).all())
