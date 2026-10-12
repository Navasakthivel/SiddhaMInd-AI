"""Resolving a corpus PDF from an untrusted ``file_path``.

Separate from the pipeline, and stdlib-only, so the containment rule can be
tested on its own. ``source_documents.file_path`` is a database column an admin
edits and an upload form writes, so it is input, not configuration:
``../../../etc/passwd`` resolves cleanly on every platform and would otherwise
be read and indexed into a corpus that gets quoted back to practitioners.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Sequence

log = logging.getLogger(__name__)


class PdfNotFoundError(FileNotFoundError):
    """Phrased for the admin dashboard, not for a stack trace."""


def is_contained(path: Path, roots: Sequence[Path]) -> bool:
    """True when ``path`` sits inside one of ``roots``.

    Compares fully resolved paths, so symlinks and ``..`` segments are already
    collapsed - checking the string before resolution is the usual way this
    gets written and the usual way it gets bypassed.
    """
    return any(path == root or root in path.parents for root in roots)


def candidate_paths(file_path: str, roots: Sequence[Path]) -> list[Path]:
    """Places a stored path might actually live, in priority order.

    Several forms are in play at once, which is why this is a search rather than
    a join: the seed data stores ``corpus/Book.pdf`` while an upload stores a
    bare filename, and ``CORPUS_DIR`` is ``./corpus`` in ``.env`` but
    ``../corpus`` when running from ``siddhamind-ai/``. A naive join of the
    first two gives ``./corpus/corpus/Book.pdf``.
    """
    raw = Path(file_path)
    candidates: list[Path] = []

    if raw.is_absolute():
        candidates.append(raw)

    for root in roots:
        candidates.append(root / raw)
        candidates.append(root / raw.name)
        if len(raw.parts) > 1:
            # Strip the stored prefix: "corpus/Book.pdf" under CORPUS_DIR=corpus.
            candidates.append(root / Path(*raw.parts[1:]))

    candidates.append(Path.cwd() / raw)
    return candidates


def resolve_pdf(file_path: str | None, corpus_dir: str, upload_dir: str) -> Path:
    """Find the PDF, refusing anything that resolves outside the two roots.

    :raises PdfNotFoundError: with the directories searched, so the operator can
        see where to put the file rather than guessing.
    """
    if not file_path or not file_path.strip():
        raise PdfNotFoundError(
            "source_documents.file_path is empty - nothing to ingest."
        )

    roots = [Path(corpus_dir).resolve(), Path(upload_dir).resolve()]
    rejected = 0

    for candidate in candidate_paths(file_path.strip(), roots):
        try:
            resolved = candidate.resolve()
        except OSError:
            continue
        if not resolved.is_file():
            continue
        if not is_contained(resolved, roots):
            rejected += 1
            log.warning(
                "Refusing %s for file_path=%r - outside the corpus and upload roots",
                resolved,
                file_path,
            )
            continue
        return resolved

    detail = (
        f" {rejected} match(es) were rejected for resolving outside those directories."
        if rejected
        else ""
    )
    raise PdfNotFoundError(
        f"PDF not found for file_path={file_path!r}. Looked under {corpus_dir} and "
        f"{upload_dir}.{detail} Place the file there, or correct "
        f"source_documents.file_path."
    )
