from __future__ import annotations

import logging
from typing import Any

import mlflow
from mlflow.tracking import MlflowClient

from app.config import MLRUNS_DIR, get_settings

logger = logging.getLogger(__name__)

_mlflow_ready = False


def _ensure_named_experiment(client: MlflowClient, name: str) -> None:
    """
    Create a named experiment if missing. A fresh file store often has no default
    experiment ID 0, which causes 'Could not find experiment with ID 0' when logging.
    """
    try:
        if client.get_experiment_by_name(name) is None:
            client.create_experiment(name)
    except Exception as e:
        logger.warning("MLflow create/get experiment %r: %s", name, e)


def init_mlflow() -> None:
    global _mlflow_ready
    settings = get_settings()
    uri = settings.mlflow_tracking_uri
    name = settings.mlflow_experiment_name or "billing_anomaly"

    try:
        MLRUNS_DIR.mkdir(parents=True, exist_ok=True)
        mlflow.set_tracking_uri(uri)
        client = MlflowClient(tracking_uri=uri)
        _ensure_named_experiment(client, name)
        mlflow.set_experiment(name)
        _mlflow_ready = True
        logger.info("MLflow ready: uri=%s experiment=%r", uri, name)
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
        with mlflow.start_run(run_name=f"feedback_{action}_{anomaly_type[:32]}"):
            mlflow.log_param("anomaly_type", anomaly_type)
            mlflow.log_param("action", action)
            if extra:
                for k, v in extra.items():
                    if isinstance(v, (int, float)):
                        mlflow.log_metric(k, float(v))
    except Exception as e:
        logger.warning("MLflow feedback log failed: %s", e)
