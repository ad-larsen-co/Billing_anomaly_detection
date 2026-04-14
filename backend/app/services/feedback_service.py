from __future__ import annotations

import logging
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.orm import AnomalyRecord, FeedbackEntry, HistoricalMetric
from app.services.mlflow_service import log_feedback_event

logger = logging.getLogger(__name__)


def record_feedback(
    session: Session,
    anomaly_id: UUID,
    action: str,
    notes: str | None,
) -> FeedbackEntry:
    anomaly = session.execute(
        select(AnomalyRecord).where(AnomalyRecord.id == anomaly_id)
    ).scalar_one_or_none()
    if anomaly is None:
        raise ValueError("Anomaly not found")

    fb = FeedbackEntry(
        anomaly_id=anomaly_id,
        action=action,
        notes=notes,
    )
    session.add(fb)

    # Simple learning loop: nudge historical TPR based on approvals vs dismissals
    try:
        metric = session.execute(
            select(HistoricalMetric).where(
                HistoricalMetric.anomaly_type == anomaly.anomaly_type
            )
        ).scalar_one_or_none()
        if metric is None:
            metric = HistoricalMetric(anomaly_type=anomaly.anomaly_type)
            session.add(metric)
            session.flush()

        metric.sample_count = int(metric.sample_count or 0) + 1
        alpha = 0.05
        if action == "approve":
            target = 1.0
        else:
            target = 0.0
        metric.true_positive_rate = (1 - alpha) * float(
            metric.true_positive_rate or 0.8
        ) + alpha * target
    except Exception as e:
        logger.warning("Feedback learning update failed: %s", e)

    try:
        log_feedback_event(
            anomaly.anomaly_type,
            action,
            extra={"confidence": anomaly.confidence},
        )
    except Exception:
        pass

    return fb
