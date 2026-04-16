from __future__ import annotations

import json
import logging
import re
from typing import Any, Iterator

from openai import OpenAI
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.exceptions import ExternalServiceError
from app.schemas import ChatMessageIn
from app.services.fact_rag import retrieve_contract_evidence

logger = logging.getLogger(__name__)


def classify_intent(question: str) -> str:
    q = question.lower().strip()
    if re.search(r"\b(how many|count|total)\b.*\b(anomaly|anomalies|issue)", q):
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


def _recent_runs_sql(session: Session) -> str:
    bind = session.get_bind()
    dialect = bind.dialect.name if bind is not None else "sqlite"
    if dialect == "postgresql":
        return (
            "SELECT id::text AS id, filename, total_rows, anomaly_count, created_at "
            "FROM analysis_runs ORDER BY created_at DESC LIMIT 10"
        )
    return (
        "SELECT CAST(id AS TEXT) AS id, filename, total_rows, anomaly_count, created_at "
        "FROM analysis_runs ORDER BY created_at DESC LIMIT 10"
    )


def prepare_nlp_llm_context(session: Session, question: str) -> dict[str, Any]:
    """Run DB + RAG steps; returns everything needed for LLM or mock output."""
    intent = classify_intent(question)
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
            sql_used = _recent_runs_sql(session)
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

    user_payload = {
        "question": question,
        "intent": intent,
        "sql_used": sql_used,
        "rows": structured_rows[:20],
        "contract_excerpt": rag_context[:3000],
    }

    return {
        "intent": intent,
        "sql_used": sql_used,
        "structured_rows": structured_rows or None,
        "rag_context": rag_context,
        "user_payload": user_payload,
    }


def _build_llm_messages(
    sys_prompt: str,
    history: list[ChatMessageIn],
    user_payload: dict[str, Any],
) -> list[dict[str, str]]:
    msgs: list[dict[str, str]] = [{"role": "system", "content": sys_prompt}]
    for m in history[-12:]:
        msgs.append({"role": m.role, "content": m.content})
    msgs.append({"role": "user", "content": str(user_payload)})
    return msgs


def hybrid_nlp_answer(
    session: Session,
    question: str,
    history: list[ChatMessageIn] | None = None,
) -> dict[str, Any]:
    ctx = prepare_nlp_llm_context(session, question)
    intent = ctx["intent"]
    sql_used = ctx["sql_used"]
    structured_rows = ctx["structured_rows"]
    user_payload = ctx["user_payload"]
    settings = get_settings()
    hist = history or []

    if settings.use_mock_ai or not settings.openai_api_key.strip():
        answer_parts = [f"Intent: {intent}."]
        if structured_rows:
            answer_parts.append(f"Structured results (sample): {structured_rows[:5]}")
        if ctx["rag_context"]:
            answer_parts.append(
                f"Contract context (truncated): {ctx['rag_context'][:400]}..."
            )
        return {
            "intent": intent,
            "answer": " ".join(answer_parts),
            "sql_used": sql_used,
            "structured_rows": structured_rows,
        }

    client = OpenAI(api_key=settings.openai_api_key)
    sys_prompt = (
        "You are a billing analytics copilot. Combine SQL/tabular results and contract snippets "
        "into a concise answer. If data is empty, say so and suggest uploading CSV or running analysis."
    )
    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=_build_llm_messages(sys_prompt, hist, user_payload),
            temperature=0.2,
            max_tokens=800,
        )
        answer = (resp.choices[0].message.content or "").strip()
        return {
            "intent": intent,
            "answer": answer,
            "sql_used": sql_used,
            "structured_rows": structured_rows,
        }
    except Exception as e:
        logger.exception("hybrid_nlp_answer LLM failed")
        raise ExternalServiceError(f"NLP generation failed: {e}", service="openai") from e


def stream_nlp_events(
    session: Session,
    question: str,
    history: list[ChatMessageIn],
) -> Iterator[dict[str, Any]]:
    """
    Yields dict events for SSE: {meta:...}, {delta: str}, optional {error: str}.
    Caller appends done event.
    """
    ctx = prepare_nlp_llm_context(session, question)
    intent = ctx["intent"]
    sql_used = ctx["sql_used"]
    structured_rows = ctx["structured_rows"]
    user_payload = ctx["user_payload"]
    settings = get_settings()

    yield {"meta": {"intent": intent, "sql_used": sql_used}}

    if settings.use_mock_ai or not settings.openai_api_key.strip():
        answer_parts = [f"Intent: {intent}."]
        if structured_rows:
            answer_parts.append(f"Structured results (sample): {structured_rows[:5]}")
        if ctx["rag_context"]:
            answer_parts.append(
                f"Contract context (truncated): {ctx['rag_context'][:400]}..."
            )
        yield {"delta": " ".join(answer_parts)}
        return

    client = OpenAI(api_key=settings.openai_api_key)
    sys_prompt = (
        "You are a billing analytics copilot. Combine SQL/tabular results and contract snippets "
        "into a concise answer. If data is empty, say so and suggest uploading CSV or running analysis."
    )
    messages = _build_llm_messages(sys_prompt, history, user_payload)
    try:
        stream = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            temperature=0.2,
            max_tokens=800,
            stream=True,
        )
        for chunk in stream:
            ch = chunk.choices[0].delta.content
            if ch:
                yield {"delta": ch}
    except Exception as e:
        logger.exception("stream_nlp_events LLM failed")
        yield {"error": str(e)}
