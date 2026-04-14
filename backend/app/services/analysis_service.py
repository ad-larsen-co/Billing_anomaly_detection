from __future__ import annotations

import logging
import uuid
from typing import Any

import pandas as pd
from sqlalchemy.orm import Session

from app.models.orm import AnalysisRun, AnomalyRecord
from app.services.confidence_engine import compute_confidence, map_to_canonical
from app.services.fact_rag import format_evidence_refs, retrieve_contract_evidence
from app.services.hf_detector import extract_anomaly_rows, normalize_hf_summary
from app.services.mlflow_service import log_analysis_run
from app.services.solver_rag import generate_remediation

logger = logging.getLogger(__name__)


def persist_analysis(
    session: Session,
    filename: str | None,
    df: pd.DataFrame,
    hf_payload: dict[str, Any],
) -> AnalysisRun:
    summary = normalize_hf_summary(hf_payload.get("summary"))
    raw_preview = hf_payload.get("preview")
    total_rows = len(df)

    rows = extract_anomaly_rows(df, hf_payload)

    run = AnalysisRun(
        id=uuid.uuid4(),
        filename=filename,
        total_rows=total_rows,
        anomaly_count=len(rows),
        raw_summary={"summary": summary, "preview_meta": str(type(raw_preview))},
    )
    session.add(run)
    session.flush()

    for item in rows:
        q = " ".join(
            filter(
                None,
                [
                    str(item.get("anomaly_type")),
                    str(item.get("explanation")),
                    str(item.get("order_id")),
                ],
            )
        )
        try:
            evidence_raw = retrieve_contract_evidence(session, q, top_k=3)
            evidence_refs = format_evidence_refs(evidence_raw)
        except Exception as e:
            logger.warning("Fact RAG failed for row; using empty evidence: %s", e)
            evidence_refs = []

        canon = map_to_canonical(str(item.get("anomaly_type", "unknown")))
        conf = compute_confidence(
            session,
            canon,
            item.get("model_payload"),
            evidence_refs,
        )
        try:
            remediation = generate_remediation(
                session,
                str(item.get("explanation") or canon),
                evidence_raw if evidence_refs else [],
            )
        except Exception as e:
            logger.warning("Solver RAG failed; storing placeholder: %s", e)
            remediation = "Remediation temporarily unavailable. Review contract evidence manually."

        ar = AnomalyRecord(
            id=uuid.uuid4(),
            run_id=run.id,
            row_index=int(item.get("row_index", -1)),
            order_id=item.get("order_id"),
            customer_id=None,
            anomaly_type=canon,
            severity=str(item.get("severity") or "medium"),
            explanation=item.get("explanation"),
            model_payload=item.get("model_payload"),
            confidence=conf,
            evidence_refs=evidence_refs,
            remediation=remediation,
        )
        session.add(ar)

    session.flush()

    try:
        log_analysis_run(
            str(run.id),
            metrics={
                "total_rows": float(total_rows),
                "anomaly_count": float(len(rows)),
            },
            params={"filename": filename},
            tags={"pipeline": "billing_anomaly"},
        )
    except Exception as e:
        logger.warning("MLflow analysis log skipped: %s", e)

    return run
