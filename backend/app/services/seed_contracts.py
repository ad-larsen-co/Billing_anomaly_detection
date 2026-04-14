from __future__ import annotations

import logging
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.orm import ContractChunk, HistoricalMetric
from app.services.confidence_engine import CANONICAL_TYPES
from app.services.embeddings import embed_texts

logger = logging.getLogger(__name__)

DEFAULT_CLAUSES: list[tuple[str, str]] = [
    (
        "Global Price List 2024",
        "Unit prices must match the active price list for the product category and currency. "
        "Discounts above 15% require director approval documented in the sales order.",
    ),
    (
        "Duplicate billing prevention",
        "The same order line must not be invoiced twice. Rebill requires a credit memo referencing "
        "the original invoice number.",
    ),
    (
        "Tax and VAT compliance",
        "Tax jurisdiction is determined by ship-to location. Exempt customers must provide a valid "
        "certificate on file before zero-rating applies.",
    ),
    (
        "Quantity and fulfillment",
        "Billed quantity cannot exceed shipped quantity for fulfilled orders. Partial shipments "
        "must align with packing slip quantities.",
    ),
    (
        "Payment terms",
        "Payment method on the order must match the settlement instrument used. Split payments "
        "require treasury approval.",
    ),
    (
        "Fraud monitoring",
        "Velocity checks may hold high-risk transactions. Orders with mismatched billing/shipping "
        "countries require manual review by Risk Operations.",
    ),
]


def seed_if_empty(session: Session) -> None:
    count = session.execute(select(func.count()).select_from(ContractChunk)).scalar_one()
    if count and count > 0:
        return

    texts = [c[1] for c in DEFAULT_CLAUSES]
    titles = [c[0] for c in DEFAULT_CLAUSES]
    try:
        vectors = embed_texts(texts)
    except Exception as e:
        logger.exception("Embedding seed failed: %s", e)
        raise

    for title, body, vec in zip(titles, texts, vectors, strict=False):
        session.add(
            ContractChunk(
                id=uuid.uuid4(),
                title=title,
                content=body,
                embedding=vec.tolist(),
            )
        )

    for t in CANONICAL_TYPES:
        exists = session.execute(
            select(HistoricalMetric).where(HistoricalMetric.anomaly_type == t)
        ).scalar_one_or_none()
        if not exists:
            session.add(
                HistoricalMetric(
                    anomaly_type=t,
                    true_positive_rate=0.82,
                    sample_count=0,
                )
            )
    logger.info("Seeded contract chunks and historical metrics.")
