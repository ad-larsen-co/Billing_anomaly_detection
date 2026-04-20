from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = ROOT / ".env"
DEFAULT_SQLITE_PATH = ROOT / "billing_anomaly.db"
# Stable MLflow file store under project root (avoids cwd-relative ./mlruns confusion)
MLRUNS_DIR = (ROOT / "mlruns").resolve()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    openai_api_key: str = ""
    # Default SQLite for local runs; Postgres+pgvector supported via docker-compose
    database_url: str = f"sqlite:///{DEFAULT_SQLITE_PATH.resolve().as_posix()}"
    hf_space_url: str = "https://luca1028-anomaly-detector.hf.space"
    mlflow_tracking_uri: str = MLRUNS_DIR.as_uri()
    mlflow_experiment_name: str = "billing_anomaly"
    use_mock_ai: bool = False
    # auto: try Sentence Transformers + PyTorch; hash: deterministic vectors only (avoids torch DLL issues on Windows)
    embedding_backend: Literal["auto", "hash"] = "auto"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    # Fact RAG corpus: default `data/contract_evidence.txt` under repo root (## sections), or set dir for one .txt per file
    contract_evidence_file: str = ""
    contract_evidence_dir: str = ""
    # If true, delete all contract_chunks on startup and re-embed from evidence files (use after editing txt)
    contract_force_reingest: bool = False

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def contract_evidence_file_path(self) -> Path:
        raw = self.contract_evidence_file.strip()
        if raw:
            p = Path(raw)
            return p.resolve() if p.is_absolute() else (ROOT / p).resolve()
        return (ROOT / "data" / "contract_evidence.txt").resolve()

    @property
    def contract_evidence_dir_path(self) -> Path | None:
        raw = self.contract_evidence_dir.strip()
        if not raw:
            return None
        p = Path(raw)
        return p.resolve() if p.is_absolute() else (ROOT / p).resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()
