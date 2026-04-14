from __future__ import annotations

import logging
import os
import sys
from contextlib import asynccontextmanager

# Windows: avoid Unicode errors from dependencies writing to cp1252 consoles
if sys.platform == "win32":
    os.environ.setdefault("PYTHONUTF8", "1")
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.database import init_db, session_scope
from app.exceptions import AppError
from app.routers import analyze, feedback, health, nlp
from app.services.mlflow_service import init_mlflow
from app.services.seed_contracts import seed_if_empty

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        init_db()
        with session_scope() as session:
            try:
                seed_if_empty(session)
            except Exception as e:
                logger.exception("Contract seed failed (non-fatal): %s", e)
        init_mlflow()
    except Exception as e:
        logger.exception("Startup failed: %s", e)
        raise
    yield


app = FastAPI(title="Billing Anomaly Platform API", lifespan=lifespan)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(AppError)
async def app_error_handler(_: Request, exc: AppError):
    return JSONResponse(
        status_code=400,
        content={"detail": exc.message, "code": exc.code},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(_: Request, exc: Exception):
    logger.exception("Unhandled error")
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "error": str(exc)},
    )


app.include_router(health.router)
app.include_router(analyze.router)
app.include_router(nlp.router)
app.include_router(feedback.router)


@app.get("/")
def root():
    return {
        "service": "billing-anomaly-api",
        "docs": "/docs",
        "health": "/health",
    }
