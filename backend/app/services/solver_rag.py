from __future__ import annotations

import logging
from typing import Any

from openai import OpenAI
from sqlalchemy.orm import Session

from app.config import get_settings
from app.exceptions import ExternalServiceError

logger = logging.getLogger(__name__)


def generate_remediation(
    session: Session,
    anomaly_summary: str,
    evidence: list[dict[str, Any]],
) -> str:
    """
    Solver RAG: GPT-4o-mini generates remediation using retrieved facts as grounding.
    """
    settings = get_settings()
    if settings.use_mock_ai or not settings.openai_api_key.strip():
        bullets = "\n".join(
            f"- {e.get('title')}: {(e.get('content') or '')[:200]}..."
            for e in evidence[:3]
        )
        return (
            "[Mock AI] Recommended steps:\n"
            "1) Validate charge against contract clauses below.\n"
            "2) Open a billing review case with Finance.\n"
            "3) Notify the customer if a correction is required.\n\n"
            f"Grounding snippets:\n{bullets or 'No contract snippets retrieved.'}"
        )

    context_blocks = []
    for e in evidence:
        context_blocks.append(
            f"Title: {e.get('title')}\nText: {e.get('content')}"
        )
    context = "\n\n".join(context_blocks) or "No contract context retrieved."

    client = OpenAI(api_key=settings.openai_api_key)
    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a billing operations expert. Given contract evidence and an "
                        "anomaly summary, produce a concise remediation playbook (numbered steps). "
                        "Do not invent contract terms not present in the evidence; if evidence is thin, "
                        "say what to verify next."
                    ),
                },
                {
                    "role": "user",
                    "content": f"Anomaly summary:\n{anomaly_summary}\n\nContract evidence:\n{context}",
                },
            ],
            temperature=0.2,
            max_tokens=600,
        )
        text = resp.choices[0].message.content or ""
        return text.strip()
    except Exception as e:
        logger.exception("Solver RAG OpenAI call failed")
        raise ExternalServiceError(
            f"Remediation generation failed: {e}", service="openai"
        ) from e
