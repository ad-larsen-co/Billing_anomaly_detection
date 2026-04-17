# Billing anomaly platform

Separated **FastAPI backend** (`backend/`) and **React + Vite frontend** (`frontend/`).

## Features

- Hugging Face Space integration via **Gradio Client** (`/gradio_api/call/run`). The path `/detect` is not the Gradio API; the deployed app is a Gradio file upload interface.
- **Dual RAG**: Fact RAG (Sentence Transformers embeddings + retrieval; cosine similarity over stored clauses; optional Postgres + pgvector in production) and Solver RAG (GPT‑4o‑mini remediation).
- **Confidence scoring** from model payload, evidence strength, and historical metrics.
- **NLP interface**: intent routing + governed SQL + hybrid synthesis with GPT‑4o‑mini.
- **Feedback loop** with stored approvals/dismissals and MLflow metric logging.
- **Heuristic fallback** if the Space errors or is unreachable, so demos still surface six anomaly families.

## Configuration

1. Copy `.env.example` to `.env` at the repo root.
2. Set `OPENAI_API_KEY` for Solver RAG and NLP (optional: set `USE_MOCK_AI=true` to skip live OpenAI calls).

## Run locally

**Backend** (defaults to SQLite at `billing_anomaly.db` in the project root):

```powershell
cd backend
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

If port `8000` is already used by another app on your machine, keep using `8000` (matches the frontend proxy).

**Frontend**:

```powershell
cd frontend
npm install
npm run dev
```

Open the URL Vite prints (often `http://localhost:5173`). The dev server proxies `/api` and `/health` to `http://127.0.0.1:8000`.

## Optional Postgres (pgvector)

Use `docker compose up -d` and set in `.env`:

`DATABASE_URL=postgresql+psycopg2://billing:billing@localhost:5433/billing_anomaly`

Embeddings are stored as JSON arrays; you can migrate to native `vector` columns and ANN queries for large corpora.

## Sample data

- `scripts/sample_tiny.csv` — quick smoke test.
- `python scripts/generate_sample_csv.py` — writes ~2400 rows to `sample_billing_2400.csv`.

## API docs

With the backend running: `http://127.0.0.1:8000/docs`
