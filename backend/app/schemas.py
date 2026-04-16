from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class AnomalyOut(BaseModel):
    id: UUID
    row_index: int
    order_id: str | None
    customer_id: str | None
    anomaly_type: str
    severity: str
    explanation: str | None
    confidence: float
    evidence_refs: list[dict[str, Any]] | None = None
    remediation: str | None
    model_payload: dict[str, Any] | None = None


class AnalysisRunOut(BaseModel):
    id: UUID
    filename: str | None
    total_rows: int
    anomaly_count: int
    created_at: datetime
    anomalies: list[AnomalyOut] = Field(default_factory=list)
    raw_summary: dict[str, Any] | None = None


class ChatMessageIn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=12000)


class NLPQueryIn(BaseModel):
    question: str = Field(..., min_length=1, max_length=4000)
    session_id: str | None = Field(None, max_length=128)
    messages: list[ChatMessageIn] = Field(default_factory=list)


class NLPQueryOut(BaseModel):
    intent: str
    answer: str
    sql_used: str | None = None
    structured_rows: list[dict[str, Any]] | None = None


class FeedbackIn(BaseModel):
    anomaly_id: UUID
    action: Literal["approve", "dismiss"]
    notes: str | None = Field(None, max_length=2000)


class FeedbackOut(BaseModel):
    id: UUID
    anomaly_id: UUID
    action: str
    notes: str | None = None
    created_at: datetime


class FeedbackListItem(BaseModel):
    id: UUID
    anomaly_id: UUID
    order_id: str | None
    action: str
    notes: str | None
    created_at: datetime


class HealthOut(BaseModel):
    status: str
    database: str
    hf_space: str
