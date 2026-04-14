from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, File, HTTPException, UploadFile

from app.database import session_scope
from app.exceptions import AppError, ValidationError
from app.models.orm import AnalysisRun, AnomalyRecord
from app.schemas import AnalysisRunOut, AnomalyOut
from app.services.analysis_service import persist_analysis
from app.services.hf_detector import analyze_uploaded_csv
from sqlalchemy.orm import joinedload

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["analyze"])


def _serialize_run(run: AnalysisRun) -> AnalysisRunOut:
    anomalies: list[AnomalyOut] = []
    for a in run.anomalies:
        anomalies.append(
            AnomalyOut(
                id=a.id,
                row_index=a.row_index,
                order_id=a.order_id,
                customer_id=a.customer_id,
                anomaly_type=a.anomaly_type,
                severity=a.severity,
                explanation=a.explanation,
                confidence=a.confidence,
                evidence_refs=a.evidence_refs,
                remediation=a.remediation,
                model_payload=a.model_payload,
            )
        )
    return AnalysisRunOut(
        id=run.id,
        filename=run.filename,
        total_rows=run.total_rows,
        anomaly_count=run.anomaly_count,
        created_at=run.created_at,
        anomalies=anomalies,
        raw_summary=run.raw_summary,
    )


@router.post("/analyze", response_model=AnalysisRunOut)
async def analyze_csv(file: UploadFile = File(...)) -> AnalysisRunOut:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")

    try:
        contents = await file.read()
        df, hf_out = analyze_uploaded_csv(contents, file.filename)
    except ValidationError as e:
        raise HTTPException(status_code=400, detail=e.message) from e
    except AppError as e:
        raise HTTPException(status_code=502, detail=e.message) from e
    except Exception as e:
        logger.exception("analyze_csv failed")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {e}") from e

    try:
        with session_scope() as session:
            run = persist_analysis(session, file.filename, df, hf_out)
            session.refresh(run)
            run = (
                session.query(AnalysisRun)
                .options(joinedload(AnalysisRun.anomalies))
                .filter(AnalysisRun.id == run.id)
                .one()
            )
            return _serialize_run(run)
    except AppError as e:
        raise HTTPException(status_code=500, detail=e.message) from e
    except Exception as e:
        logger.exception("persist_analysis failed")
        raise HTTPException(status_code=500, detail=f"Persistence failed: {e}") from e


@router.get("/runs/{run_id}", response_model=AnalysisRunOut)
def get_run(run_id: UUID) -> AnalysisRunOut:
    try:
        with session_scope() as session:
            run = (
                session.query(AnalysisRun)
                .options(joinedload(AnalysisRun.anomalies))
                .filter(AnalysisRun.id == run_id)
                .one_or_none()
            )
            if run is None:
                raise HTTPException(status_code=404, detail="Run not found")
            return _serialize_run(run)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("get_run failed")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/anomalies", response_model=list[AnomalyOut])
def list_anomalies(limit: int = 100) -> list[AnomalyOut]:
    cap = min(max(limit, 1), 500)
    try:
        with session_scope() as session:
            rows = (
                session.query(AnomalyRecord)
                .order_by(AnomalyRecord.created_at.desc())
                .limit(cap)
                .all()
            )
            out: list[AnomalyOut] = []
            for a in rows:
                out.append(
                    AnomalyOut(
                        id=a.id,
                        row_index=a.row_index,
                        order_id=a.order_id,
                        customer_id=a.customer_id,
                        anomaly_type=a.anomaly_type,
                        severity=a.severity,
                        explanation=a.explanation,
                        confidence=a.confidence,
                        evidence_refs=a.evidence_refs,
                        remediation=a.remediation,
                        model_payload=a.model_payload,
                    )
                )
            return out
    except Exception as e:
        logger.exception("list_anomalies failed")
        raise HTTPException(status_code=500, detail=str(e)) from e
