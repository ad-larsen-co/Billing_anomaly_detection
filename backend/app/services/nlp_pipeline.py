from __future__ import annotations

import logging
import re
from typing import Any

from openai import OpenAI
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.exceptions import ExternalServiceError
from app.services.fact_rag import retrieve_contract_evidence

logger = logging.getLogger(__name__)


def classify_intent(question: str) -> str:
    q = question.lower().strip()
    if re.search(r"\b(how many|count|total)\b.*\b(anomal|alert|issue)", q):
        return "count_anomalies"
    if re.search(r"\b(list|show|which)\b.*\b(high|severity)", q):
        return "list_high_severity"
    if re.search(r"\b(last|recent)\b.*\b(run|analysis|upload)", q):
        return "recent_runs"
    if re.search(r"\b(contract|policy|clause|refund|credit)\b", q):
        return "contract_qa"
    if re.search(r"\b(order|customer)\b", q):
        return "lookup_order"
    return "general_billing"


def _extract_order_id(question: str) -> str | None:
    m = re.search(
        r"(?:order[_\s-]?id|order)\s*[:=#]?\s*([A-Za-z0-9\-]{4,})",
        question,
        re.I,
    )
    return m.group(1) if m else None


def hybrid_nlp_answer(session: Session, question: str) -> dict[str, Any]:
    intent = classify_intent(question)
    settings = get_settings()

    structured_rows: list[dict[str, Any]] = []
    sql_used: str | None = None

    try:
        if intent == "lookup_order":
            oid = _extract_order_id(question)
            if oid:
                sql_used = (
                    "SELECT order_id, anomaly_type, severity, confidence, explanation "
                    "FROM anomaly_records WHERE order_id = :oid LIMIT 20"
                )
                structured_rows = [
                    dict(r)
                    for r in session.execute(
                        text(sql_used), {"oid": oid}
                    ).mappings().all()
                ]

        if intent == "count_anomalies":
            sql_used = "SELECT COUNT(*) AS anomaly_count FROM anomaly_records"
            c = session.execute(text(sql_used)).scalar_one()
            structured_rows = [{"anomaly_count": int(c)}]

        if intent == "list_high_severity":
            sql_used = (
                "SELECT order_id, anomaly_type, severity, confidence "
                "FROM anomaly_records WHERE severity = 'high' "
                "ORDER BY confidence DESC LIMIT 50"
            )
            structured_rows = [
                dict(r) for r in session.execute(text(sql_used)).mappings().all()
            ]

        if intent == "recent_runs":
            sql_used = (
                "SELECT id::text AS id, filename, total_rows, anomaly_count, created_at "
                "FROM analysis_runs ORDER BY created_at DESC LIMIT 10"
            )
            structured_rows = [
                dict(r) for r in session.execute(text(sql_used)).mappings().all()
            ]
    except Exception as e:
        logger.exception("Structured NLP query failed")
        raise ExternalServiceError(f"Query failed: {e}", service="database") from e

    rag_context = ""
    if intent == "contract_qa":
        ev = retrieve_contract_evidence(session, question, top_k=4)
        rag_context = "\n".join(e["content"][:600] for e in ev)

    if intent == "general_billing" and not structured_rows:
        ev = retrieve_contract_evidence(session, question, top_k=3)
        rag_context = "\n".join(e["content"][:500] for e in ev)

    if settings.use_mock_ai or not settings.openai_api_key.strip():
        answer_parts = [f"Intent: {intent}."]
        if structured_rows:
            answer_parts.append(f"Structured results (sample): {structured_rows[:5]}")
        if rag_context:
            answer_parts.append(f"Contract context (truncated): {rag_context[:400]}...")
        return {
            "intent": intent,
            "answer": " ".join(answer_parts),
            "sql_used": sql_used,
            "structured_rows": structured_rows or None,
        }

    client = OpenAI(api_key=settings.openai_api_key)
    sys_prompt = (
        "You are a billing analytics copilot. Combine SQL/tabular results and contract snippets "
        "into a concise answer. If data is empty, say so and suggest uploading CSV or running analysis."
    )
    user_payload = {
        "question": question,
        "intent": intent,
        "sql_used": sql_used,
        "rows": structured_rows[:20],
        "contract_excerpt": rag_context[:3000],
    }
    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": str(user_payload)},
            ],
            temperature=0.2,
            max_tokens=800,
        )
        answer = (resp.choices[0].message.content or "").strip()
        return {
            "intent": intent,
            "answer": answer,
            "sql_used": sql_used,
            "structured_rows": structured_rows or None,
        }
    except Exception as e:
        logger.exception("hybrid_nlp_answer LLM failed")
        raise ExternalServiceError(f"NLP generation failed: {e}", service="openai") from e
