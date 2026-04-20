from __future__ import annotations

import logging
import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.orm import ContractChunk, HistoricalMetric
from app.services.confidence_engine import CANONICAL_TYPES
from app.services.contract_ingestion import load_evidence_clauses
from app.services.embeddings import embed_texts

logger = logging.getLogger(__name__)


def seed_if_empty(session: Session) -> None:
    settings = get_settings()

    if settings.contract_force_reingest:
        session.execute(delete(ContractChunk))
        session.flush()
        logger.info("Cleared contract_chunks (contract_force_reingest=true).")
    else:
        count = session.execute(select(func.count()).select_from(ContractChunk)).scalar_one()
        if count and count > 0:
            _seed_historical_metrics_if_needed(session)
            return

    clauses = load_evidence_clauses(settings)
    if not clauses:
        logger.warning(
            "No contract evidence clauses loaded; Fact RAG will return no hits. "
            "Add data/contract_evidence.txt (## sections) or set CONTRACT_EVIDENCE_DIR."
        )
        _seed_historical_metrics_if_needed(session)
        return

    texts = [c[1] for c in clauses]
    titles = [c[0] for c in clauses]
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

    _seed_historical_metrics_if_needed(session)
    logger.info("Ingested %d contract chunk(s) from evidence files.", len(clauses))


def _seed_historical_metrics_if_needed(session: Session) -> None:
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
