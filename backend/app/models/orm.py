from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    Uuid,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


EMBED_DIM = 384


class Base(DeclarativeBase):
    pass


class ContractChunk(Base):
    __tablename__ = "contract_chunks"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    title: Mapped[str] = mapped_column(String(512), default="")
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # JSON array of floats; Fact RAG uses cosine similarity (pgvector can index this in Postgres)
    embedding: Mapped[list[float]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow
    )


class AnalysisRun(Base):
    __tablename__ = "analysis_runs"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    filename: Mapped[str | None] = mapped_column(String(512), nullable=True)
    total_rows: Mapped[int] = mapped_column(Integer, default=0)
    anomaly_count: Mapped[int] = mapped_column(Integer, default=0)
    raw_summary: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow
    )

    anomalies: Mapped[list["AnomalyRecord"]] = relationship(
        "AnomalyRecord", back_populates="run", cascade="all, delete-orphan"
    )


class AnomalyRecord(Base):
    __tablename__ = "anomaly_records"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    run_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("analysis_runs.id", ondelete="CASCADE")
    )
    row_index: Mapped[int] = mapped_column(Integer, default=-1)
    order_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    customer_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    anomaly_type: Mapped[str] = mapped_column(String(128), default="unknown")
    severity: Mapped[str] = mapped_column(String(64), default="medium")
    explanation: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    evidence_refs: Mapped[list | None] = mapped_column(JSON, nullable=True)
    remediation: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow
    )

    run: Mapped["AnalysisRun"] = relationship("AnalysisRun", back_populates="anomalies")
    feedback: Mapped[list["FeedbackEntry"]] = relationship(
        "FeedbackEntry", back_populates="anomaly", cascade="all, delete-orphan"
    )


class FeedbackEntry(Base):
    __tablename__ = "feedback_entries"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, default=uuid.uuid4
    )
    anomaly_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("anomaly_records.id", ondelete="CASCADE")
    )
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow
    )

    anomaly: Mapped["AnomalyRecord"] = relationship(
        "AnomalyRecord", back_populates="feedback"
    )


class HistoricalMetric(Base):
    """Rolling precision/recall estimates for confidence scoring."""

    __tablename__ = "historical_metrics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    anomaly_type: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    true_positive_rate: Mapped[float] = mapped_column(Float, default=0.85)
    sample_count: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow
    )
