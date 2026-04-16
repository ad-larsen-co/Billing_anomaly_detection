from __future__ import annotations

import json
import logging
import os
import tempfile
from typing import Any

import pandas as pd
from gradio_client import Client, handle_file
from gradio_client.exceptions import AppError

from app.config import get_settings
from app.exceptions import ValidationError

logger = logging.getLogger(__name__)

EXPECTED_COLUMNS = [
    "order_id",
    "customer_id",
    "order_date",
    "product_id",
    "product_name",
    "category",
    "price",
    "quantity",
    "payment_method",
    "country",
    "city",
    "is_fraud",
]


def _validate_dataframe(df: pd.DataFrame) -> None:
    missing = [c for c in EXPECTED_COLUMNS if c not in df.columns]
    if missing:
        raise ValidationError(
            f"CSV missing required columns: {', '.join(missing)}. "
            f"Expected: {', '.join(EXPECTED_COLUMNS)}"
        )


def run_hf_space_on_csv(csv_path: str) -> dict[str, Any]:
    """
    Calls the deployed Gradio Space (file-based /run API).
    The public path /detect is not the Gradio API; integration uses /gradio_api/call/run.
    If the Space errors or is unreachable, returns a fallback flag so local heuristics run.
    """
    settings = get_settings()
    url = settings.hf_space_url.rstrip("/")
    logger.info("Calling Hugging Face Space %s with CSV %s", url, csv_path)
    try:
        client = Client(url, verbose=False)
    except Exception as e:
        logger.warning("Gradio Client init failed; using heuristics: %s", e)
        return {
            "preview": {},
            "summary": {"fallback": True, "hf_error": str(e)},
            "hf_failed": True,
            "raw_tuple_len": 0,
        }

    try:
        result = client.predict(file=handle_file(csv_path), api_name="/run")
    except (AppError, OSError, TimeoutError, Exception) as e:
        logger.warning("Gradio predict failed; using heuristics: %s", e)
        return {
            "preview": {},
            "summary": {"fallback": True, "hf_error": str(e)},
            "hf_failed": True,
            "raw_tuple_len": 0,
        }

    # result: (preview_dict, summary_json, image_path)
    preview, summary, _image = result[0], result[1], result[2] if len(result) > 2 else None
    return {
        "preview": preview,
        "summary": summary,
        "raw_tuple_len": len(result),
        "hf_failed": False,
    }


def analyze_uploaded_csv(contents: bytes, filename: str) -> tuple[pd.DataFrame, dict[str, Any]]:
    """Validate CSV, persist temp file, call HF Space, return dataframe + hf payload."""
    if not contents:
        raise ValidationError("Empty file upload")

    suffix = os.path.splitext(filename or "")[1].lower()
    if suffix != ".csv":
        raise ValidationError("Only .csv files are supported")

    try:
        df = pd.read_csv(pd.io.common.BytesIO(contents))
    except Exception as e:
        logger.exception("pandas read_csv failed")
        raise ValidationError(f"Invalid CSV: {e}") from e

    _validate_dataframe(df)

    with tempfile.NamedTemporaryFile(mode="w+b", suffix=".csv", delete=False) as tmp:
        tmp.write(contents)
        tmp_path = tmp.name

    try:
        hf_out = run_hf_space_on_csv(tmp_path)
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            logger.warning("Could not delete temp file %s", tmp_path)

    return df, hf_out


def normalize_hf_summary(summary: Any) -> dict[str, Any]:
    """Normalize Gradio JSON output to a dict."""
    if summary is None:
        return {}
    if isinstance(summary, dict):
        return summary
    if isinstance(summary, str):
        try:
            return json.loads(summary)
        except json.JSONDecodeError:
            return {"raw_text": summary}
    return {"value": summary}


def _heuristic_six_types(df: pd.DataFrame) -> list[dict[str, Any]]:
    """
    Deterministic Oracle-style rules covering six billing anomaly families when HF is unavailable.
    """
    rows: list[dict[str, Any]] = []
    if df.empty:
        return rows

    try:
        p95 = float(df["price"].quantile(0.95))
    except Exception:
        p95 = 1e9

    dup_mask = df.duplicated(subset=["order_id"], keep=False)

    for i in range(len(df)):
        r = df.iloc[i]
        oid = str(r.get("order_id", "") or "")

        if dup_mask.iloc[i]:
            rows.append(
                {
                    "row_index": i,
                    "order_id": oid or None,
                    "anomaly_type": "duplicate_charge",
                    "severity": "high",
                    "explanation": "Duplicate order_id detected in the same upload batch.",
                    "model_payload": {"source": "heuristic", "rule": "duplicate_order_id"},
                }
            )

        try:
            price = float(r.get("price", 0) or 0)
        except (TypeError, ValueError):
            price = 0.0
        if price < 0 or price > p95 * 1.5:
            rows.append(
                {
                    "row_index": i,
                    "order_id": oid or None,
                    "anomaly_type": "pricing_mismatch",
                    "severity": "medium",
                    "explanation": f"Price outside expected band (p95≈{p95:.2f}).",
                    "model_payload": {"source": "heuristic", "rule": "price_band", "price": price},
                }
            )

        try:
            qty = int(float(r.get("quantity", 0) or 0))
        except (TypeError, ValueError):
            qty = 0
        if qty < 1 or qty > 500:
            rows.append(
                {
                    "row_index": i,
                    "order_id": oid or None,
                    "anomaly_type": "quantity_anomaly",
                    "severity": "medium",
                    "explanation": "Quantity outside plausible fulfillment range.",
                    "model_payload": {"source": "heuristic", "rule": "quantity_range", "quantity": qty},
                }
            )

        pay = str(r.get("payment_method", "") or "").strip()
        if not pay or pay.lower() == "nan":
            rows.append(
                {
                    "row_index": i,
                    "order_id": oid or None,
                    "anomaly_type": "payment_method_inconsistency",
                    "severity": "medium",
                    "explanation": "Missing or blank payment instrument on the order line.",
                    "model_payload": {"source": "heuristic", "rule": "payment_method_missing"},
                }
            )

        country = str(r.get("country", "") or "").upper()
        city = str(r.get("city", "") or "").lower()
        if country in {"US", "UK"} and city in {"berlin", "paris"}:
            rows.append(
                {
                    "row_index": i,
                    "order_id": oid or None,
                    "anomaly_type": "tax_compliance",
                    "severity": "high",
                    "explanation": "Ship-to / tax jurisdiction mismatch between country and city cues.",
                    "model_payload": {"source": "heuristic", "rule": "jurisdiction_mismatch"},
                }
            )

        try:
            fraud = int(r.get("is_fraud", 0) or 0) == 1
        except (TypeError, ValueError):
            fraud = str(r.get("is_fraud", "")).lower() in ("true", "yes", "1")
        if fraud:
            rows.append(
                {
                    "row_index": i,
                    "order_id": oid or None,
                    "anomaly_type": "fraud_signal",
                    "severity": "high",
                    "explanation": "Fraud indicator column set for this row.",
                    "model_payload": {"source": "heuristic", "rule": "is_fraud"},
                }
            )

    return rows


def _coerce_bool(v: Any) -> bool:
    if v is True:
        return True
    if v is False or v is None:
        return False
    if isinstance(v, (int, float)):
        return bool(v) and v != 0
    s = str(v).strip().lower()
    return s in ("true", "yes", "1", "y")


def _header_index(headers: list[Any]) -> dict[str, int]:
    return {str(h): i for i, h in enumerate(headers)}


def _pick_col(
    header_index: dict[str, int],
    names: tuple[str, ...],
) -> int | None:
    for n in names:
        if n in header_index:
            return header_index[n]
    return None


def extract_anomaly_rows(
    df: pd.DataFrame, hf_out: dict[str, Any]
) -> list[dict[str, Any]]:
    """
    Build per-row anomaly structures from HF preview/summary.
    Falls back to heuristics if the model returns only aggregate JSON.

    Hugging Face Gradio Spaces (e.g. luca1028-anomaly-detector) typically return a
    preview Dataframe with columns like: final_score, is_anomaly, scores (dict).
    Older parsers only looked for anomaly_score / anomaly_type and dropped all rows.
    """
    preview = hf_out.get("preview") or {}
    summary = normalize_hf_summary(hf_out.get("summary"))

    if hf_out.get("hf_failed") or summary.get("fallback"):
        return _heuristic_six_types(df)

    rows: list[dict[str, Any]] = []

    # If preview has dataframe shape from Gradio
    headers = preview.get("headers") or list(df.columns)
    data = preview.get("data")
    if isinstance(data, list) and data:
        hi = _header_index(headers)
        is_anomaly_col = _pick_col(
            hi,
            ("is_anomaly", "anomaly_flag", "predicted_anomaly", "is_anomalous"),
        )
        score_col = _pick_col(
            hi,
            (
                "final_score",
                "anomaly_score",
                "score",
                "anomaly",
                "prediction",
            ),
        )
        type_col = _pick_col(
            hi,
            ("anomaly_type", "type", "label", "reason", "category"),
        )
        scores_col = _pick_col(hi, ("scores", "score_components", "component_scores"))

        for i, row in enumerate(data):
            if not isinstance(row, (list, tuple)):
                continue

            is_anom = False
            if is_anomaly_col is not None and is_anomaly_col < len(row):
                is_anom = _coerce_bool(row[is_anomaly_col])
            elif score_col is not None and score_col < len(row):
                try:
                    is_anom = float(row[score_col]) > 0.5
                except (TypeError, ValueError):
                    is_anom = False
            elif type_col is not None and type_col < len(row):
                at = str(row[type_col]).strip().lower()
                is_anom = bool(at) and at not in ("normal", "ok", "0", "benign", "negative")
            else:
                continue

            if not is_anom:
                continue

            final_score: float | None = None
            if score_col is not None and score_col < len(row):
                try:
                    final_score = float(row[score_col])
                except (TypeError, ValueError):
                    final_score = None

            atype = "hf_model_anomaly"
            if type_col is not None and type_col < len(row):
                atype = str(row[type_col]) or atype
            elif scores_col is not None and scores_col < len(row) and isinstance(
                row[scores_col], dict
            ):
                comp = row[scores_col]
                if isinstance(comp, dict) and comp:
                    top = max(comp.items(), key=lambda kv: float(kv[1] or 0))
                    atype = f"hf_{top[0]}"

            oid = None
            if "order_id" in hi and hi["order_id"] < len(row):
                oid = row[hi["order_id"]]

            scores_obj: Any = None
            if scores_col is not None and scores_col < len(row):
                scores_obj = row[scores_col]

            expl_parts = [
                "Flagged by Hugging Face anomaly detector.",
            ]
            if final_score is not None:
                expl_parts.append(f"final_score={final_score:.4f}.")
            if isinstance(scores_obj, dict) and scores_obj:
                parts: list[str] = []
                for k, v in scores_obj.items():
                    if v is None:
                        continue
                    try:
                        parts.append(f"{k}={float(v):.4f}")
                    except (TypeError, ValueError):
                        parts.append(f"{k}={v!r}")
                if parts:
                    expl_parts.append("Components: " + ", ".join(parts))

            rows.append(
                {
                    "row_index": i,
                    "order_id": str(oid) if oid is not None else None,
                    "anomaly_type": atype,
                    "severity": "high"
                    if (final_score is not None and final_score > 0.8)
                    else "medium",
                    "explanation": " ".join(expl_parts),
                    "model_payload": {
                        "source": "huggingface_space",
                        "preview_row": row,
                        "headers": headers,
                        "scores": scores_obj,
                        "summary": summary,
                    },
                }
            )

    if rows:
        return rows

    # Fallback: use summary list or mark rows with is_fraud == 1
    listed = summary.get("anomalies") or summary.get("records") or summary.get("items")
    if isinstance(listed, list):
        for item in listed:
            if not isinstance(item, dict):
                continue
            rows.append(
                {
                    "row_index": int(item.get("row_index", -1)),
                    "order_id": str(item.get("order_id", "")) or None,
                    "anomaly_type": str(item.get("anomaly_type", "unspecified")),
                    "severity": str(item.get("severity", "medium")),
                    "explanation": item.get("explanation") or item.get("reason"),
                    "model_payload": item,
                }
            )
        if rows:
            return rows

    fraud_col = "is_fraud" if "is_fraud" in df.columns else None
    if fraud_col is not None:
        for i, val in enumerate(df[fraud_col].tolist()):
            try:
                flag = int(val) == 1 or str(val).lower() in ("true", "yes")
            except (TypeError, ValueError):
                flag = False
            if flag:
                rows.append(
                    {
                        "row_index": i,
                        "order_id": str(df.iloc[i].get("order_id", "")),
                        "anomaly_type": "fraud_signal",
                        "severity": "high",
                        "explanation": "Row marked is_fraud in dataset (fallback signal).",
                        "model_payload": {"source": "is_fraud_column"},
                    }
                )

    return rows
