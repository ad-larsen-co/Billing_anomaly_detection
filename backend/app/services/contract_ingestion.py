from __future__ import annotations

import logging
import re
from pathlib import Path

from app.config import Settings

logger = logging.getLogger(__name__)


def _split_by_markdown_h2(text: str) -> list[tuple[str, str]]:
    """Split on lines like `## Section title`. Returns (title, body) pairs."""
    text = text.strip()
    if not text:
        return []

    parts = re.split(r"^##\s+(.+?)\s*$", text, flags=re.MULTILINE)
    chunks: list[tuple[str, str]] = []

    if len(parts) == 1:
        # No H2 headings — one document
        return [("Contract evidence", text)]

    preamble = parts[0].strip()
    if preamble:
        chunks.append(("Preamble", preamble))

    for i in range(1, len(parts), 2):
        title = parts[i].strip()
        body = (parts[i + 1] if i + 1 < len(parts) else "").strip()
        if title and body:
            chunks.append((title, body))
    return chunks


def _load_from_directory(directory: Path) -> list[tuple[str, str]]:
    """Each `*.txt` file becomes one chunk; title = filename stem (spaces for underscores)."""
    if not directory.is_dir():
        logger.warning("Contract evidence directory does not exist: %s", directory)
        return []

    clauses: list[tuple[str, str]] = []
    for path in sorted(directory.glob("*.txt")):
        try:
            body = path.read_text(encoding="utf-8").strip()
        except OSError as e:
            logger.warning("Could not read evidence file %s: %s", path, e)
            continue
        if not body:
            continue
        title = path.stem.replace("_", " ").strip() or path.name
        clauses.append((title, body))
    return clauses


def _load_from_single_file(path: Path) -> list[tuple[str, str]]:
    if not path.is_file():
        logger.warning("Contract evidence file not found: %s", path)
        return []
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as e:
        logger.warning("Could not read evidence file %s: %s", path, e)
        return []
    return _split_by_markdown_h2(text)


def load_evidence_clauses(settings: Settings) -> list[tuple[str, str]]:
    """
    Load (title, content) clauses for Fact RAG.

    If `contract_evidence_dir` is set and the path exists as a directory, every
    `*.txt` in that directory is one chunk (filename stem = title).

    Otherwise reads `contract_evidence_file` if set, else `data/contract_evidence.txt`
    under the repo root, splitting on `##` section headings.
    """
    ev_dir = settings.contract_evidence_dir_path
    if ev_dir is not None:
        return _load_from_directory(ev_dir)

    path = settings.contract_evidence_file_path
    return _load_from_single_file(path)
