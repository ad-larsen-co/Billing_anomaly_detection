from __future__ import annotations

import hashlib
import logging
from functools import lru_cache

import numpy as np

from app.config import get_settings

logger = logging.getLogger(__name__)

_MODEL = None
_ST_LOAD_FAILED = False


def _fallback_vector(text: str, dim: int = 384) -> np.ndarray:
    """Deterministic pseudo-embedding when Sentence Transformers / torch is unavailable."""
    h = hashlib.sha256(text.encode("utf-8", errors="ignore")).digest()
    seed = int.from_bytes(h[:8], "little") % (2**32)
    rng = np.random.RandomState(seed)
    v = rng.randn(dim).astype(np.float32)
    n = np.linalg.norm(v) + 1e-9
    return v / n


@lru_cache(maxsize=1)
def _model_name() -> str:
    return "sentence-transformers/all-MiniLM-L6-v2"


def _should_try_sentence_transformers() -> bool:
    settings = get_settings()
    if getattr(settings, "use_mock_ai", False):
        return False
    return True


def get_embedder():
    global _MODEL, _ST_LOAD_FAILED
    if _ST_LOAD_FAILED:
        return None
    if _MODEL is not None:
        return _MODEL
    if not _should_try_sentence_transformers():
        _ST_LOAD_FAILED = True
        return None
    try:
        from sentence_transformers import SentenceTransformer

        _MODEL = SentenceTransformer(_model_name())
        logger.info("Loaded SentenceTransformer model %s", _model_name())
    except Exception as e:
        logger.warning(
            "SentenceTransformer unavailable (%s); using deterministic fallback embeddings.",
            e,
        )
        _ST_LOAD_FAILED = True
        _MODEL = None
    return _MODEL


def embed_texts(texts: list[str]) -> np.ndarray:
    if not texts:
        return np.zeros((0, 384), dtype=np.float32)
    model = get_embedder()
    if model is not None:
        try:
            emb = model.encode(texts, normalize_embeddings=True)
            return np.asarray(emb, dtype=np.float32)
        except Exception as e:
            logger.warning("SentenceTransformer encode failed; fallback: %s", e)

    out = np.stack([_fallback_vector(t) for t in texts])
    return out.astype(np.float32)


def embed_query(text: str) -> np.ndarray:
    return embed_texts([text])[0]
