from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.orm import HistoricalMetric

logger = logging.getLogger(__name__)

# Six canonical anomaly families (aligned with Oracle billing analytics scenarios)
CANONICAL_TYPES = (
    "pricing_mismatch",
    "duplicate_charge",
    "tax_compliance",
    "quantity_anomaly",
    "payment_method_inconsistency",
    "fraud_signal",
)


def _clamp(x: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def map_to_canonical(raw_type: str) -> str:
    t = (raw_type or "").lower()
    if any(k in t for k in ("price", "pricing", "discount")):
        return "pricing_mismatch"
    if "duplicate" in t or "double" in t:
        return "duplicate_charge"
    if "tax" in t or "vat" in t:
        return "tax_compliance"
    if "quantity" in t or "qty" in t or "volume" in t:
        return "quantity_anomaly"
    if "payment_method" in t or "card" in t or "invoice" in t:
        return "payment_method_inconsistency"
    if "fraud" in t or "suspicious" in t:
        return "fraud_signal"
    return "fraud_signal" if "fraud" in t else "pricing_mismatch"


def model_agreement_score(model_payload: dict[str, Any] | None) -> float:
    """Heuristic: higher if multiple model signals agree (placeholder for ensemble)."""
    if not model_payload:
        return 0.55
    if model_payload.get("source") == "is_fraud_column":
        return 0.6
    preview_row = model_payload.get("preview_row")
    if isinstance(preview_row, list) and len(preview_row) > 1:
        return 0.75
    return 0.68


def model_precision_prior(anomaly_type: str) -> float:
    """Static prior by type (replace with calibrated values from MLflow)."""
    priors = {
        "pricing_mismatch": 0.82,
        "duplicate_charge": 0.88,
        "tax_compliance": 0.79,
        "quantity_anomaly": 0.81,
        "payment_method_inconsistency": 0.77,
        "fraud_signal": 0.73,
    }
    return priors.get(anomaly_type, 0.75)


def evidence_strength(evidence_refs: list[dict[str, Any]] | None) -> float:
    if not evidence_refs:
        return 0.35
    scores = [float(r.get("relevance") or 0.0) for r in evidence_refs]
    if not scores:
        return 0.4
    return _clamp(sum(scores) / len(scores))


def historical_performance(session: Session, anomaly_type: str) -> float:
    try:
        row = session.execute(
            select(HistoricalMetric).where(
                HistoricalMetric.anomaly_type == anomaly_type
            )
        ).scalar_one_or_none()
        if row is None:
            return 0.82
        return _clamp(float(row.true_positive_rate))
    except Exception as e:
        logger.warning("historical_performance lookup failed: %s", e)
        return 0.8


def compute_confidence(
    session: Session,
    anomaly_type: str,
    model_payload: dict[str, Any] | None,
    evidence_refs: list[dict[str, Any]] | None,
) -> float:
    """
    Weighted blend:
    - model agreement
    - model precision prior
    - evidence strength
    - historical performance
    """
    canon = map_to_canonical(anomaly_type)
    ma = model_agreement_score(model_payload)
    mp = model_precision_prior(canon)
    ev = evidence_strength(evidence_refs)
    hp = historical_performance(session, canon)

    score = 0.30 * ma + 0.25 * mp + 0.25 * ev + 0.20 * hp
    return round(_clamp(score), 4)
