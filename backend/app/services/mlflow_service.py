from __future__ import annotations

import logging
import os
from typing import Any

import mlflow

from app.config import get_settings

logger = logging.getLogger(__name__)

_mlflow_ready = False


def init_mlflow() -> None:
    global _mlflow_ready
    settings = get_settings()
    uri = settings.mlflow_tracking_uri
    try:
        mlflow.set_tracking_uri(uri)
        os.makedirs(uri.replace("file:", ""), exist_ok=True) if uri.startswith(
            "file:"
        ) else None
        _mlflow_ready = True
    except Exception as e:
        logger.warning("MLflow init failed (non-fatal): %s", e)
        _mlflow_ready = False


def log_analysis_run(
    run_id: str,
    metrics: dict[str, float],
    params: dict[str, str | None] | None = None,
    tags: dict[str, str] | None = None,
) -> None:
    if not _mlflow_ready:
        return
    try:
        with mlflow.start_run(run_name=f"analysis_{run_id[:8]}"):
            for k, v in metrics.items():
                mlflow.log_metric(k, float(v))
            if params:
                for k, v in params.items():
                    mlflow.log_param(k, v or "")
            if tags:
                mlflow.set_tags(tags)
    except Exception as e:
        logger.warning("MLflow logging failed: %s", e)


def log_feedback_event(
    anomaly_type: str,
    action: str,
    extra: dict[str, Any] | None = None,
) -> None:
    if not _mlflow_ready:
        return
    try:
        with mlflow.start_run(run_name="feedback"):
            mlflow.log_param("anomaly_type", anomaly_type)
            mlflow.log_param("action", action)
            if extra:
                for k, v in extra.items():
                    if isinstance(v, (int, float)):
                        mlflow.log_metric(k, float(v))
    except Exception as e:
        logger.warning("MLflow feedback log failed: %s", e)
