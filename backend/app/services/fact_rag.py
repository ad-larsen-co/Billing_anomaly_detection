from __future__ import annotations

import logging
from typing import Any

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.orm import ContractChunk
from app.services.embeddings import embed_query

logger = logging.getLogger(__name__)


def _cosine(a: np.ndarray, b: list[float]) -> float:
    bv = np.asarray(b, dtype=np.float32)
    denom = (np.linalg.norm(a) * np.linalg.norm(bv)) + 1e-9
    return float(np.dot(a, bv) / denom)


def retrieve_contract_evidence(
    session: Session,
    query: str,
    top_k: int = 4,
) -> list[dict[str, Any]]:
    """
    Fact RAG: retrieval-only verbatim contract snippets.
    Uses embedding cosine similarity (compatible with SQLite and Postgres).
    For large corpora in production, swap the scoring loop for pgvector ANN SQL.
    """
    if not query or not query.strip():
        return []

    try:
        qvec = embed_query(query.strip())
    except Exception as e:
        logger.exception("Fact RAG embedding failed")
        raise RuntimeError(f"Fact RAG embedding error: {e}") from e

    try:
        rows = session.execute(select(ContractChunk)).scalars().all()
    except Exception as e:
        logger.exception("Fact RAG load failed")
        raise RuntimeError(f"Fact RAG database query failed: {e}") from e

    scored: list[tuple[float, ContractChunk]] = []
    for row in rows:
        try:
            emb = row.embedding
            if not isinstance(emb, list):
                continue
            s = _cosine(qvec, emb)
            scored.append((s, row))
        except Exception:
            continue

    scored.sort(key=lambda x: x[0], reverse=True)
    out: list[dict[str, Any]] = []
    for s, r in scored[:top_k]:
        out.append(
            {
                "id": str(r.id),
                "title": r.title,
                "content": r.content,
                "score": float(s),
            }
        )
    return out


def format_evidence_refs(evidence: list[dict[str, Any]]) -> list[dict[str, Any]]:
    refs: list[dict[str, Any]] = []
    for e in evidence:
        refs.append(
            {
                "source": "contract",
                "title": e.get("title"),
                "excerpt": (e.get("content") or "")[:800],
                "relevance": round(float(e.get("score") or 0.0), 4),
            }
        )
    return refs
