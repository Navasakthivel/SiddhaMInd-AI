"""Self-hosted dense embeddings via sentence-transformers.

No external embedding API: the corpus is a licensed clinical text and the
vectors stay on infrastructure we control.

sentence-transformers and torch are imported lazily, for the same reason as in
:mod:`app.ingestion.ocr` - the dimension checks below stay importable and
testable on a machine with neither installed.
"""

from __future__ import annotations

import logging
import threading
from typing import Any, Iterable, Sequence

log = logging.getLogger(__name__)

_model: Any = None
_model_name: str | None = None
# Two ingestions starting together would otherwise both begin the ~2 GB download
# and race on the cache directory.
_load_lock = threading.Lock()


class EmbeddingDimensionError(RuntimeError):
    """A vector's width does not match ``doc_chunks.embedding``.

    Postgres rejects a wrong-width vector, but only when the INSERT runs - by
    which point OCR and chunking of a whole book have already been paid for, and
    the transaction aborts as a unit. Checking per batch fails in seconds
    instead, with a message that names the model.
    """


def passage_prefix(model_name: str) -> str:
    """Prefix a document needs before encoding, if its model expects one.

    e5 was trained with asymmetric ``query:`` / ``passage:`` prefixes and its
    retrieval quality drops measurably without them. bge-m3 was not, and adding
    a prefix there just embeds a literal word. Both are permitted by the config,
    so the difference has to be handled rather than assumed away.
    """
    return "passage: " if "e5" in model_name.lower() else ""


def query_prefix(model_name: str) -> str:
    """The counterpart of :func:`passage_prefix`, for Phase 5 retrieval.

    Defined alongside it deliberately: using one without the other is the
    failure mode, and it is silent - every query still returns results, they are
    just worse.
    """
    return "query: " if "e5" in model_name.lower() else ""


def validate_dimensions(vectors: Sequence[Sequence[float]], expected: int) -> None:
    """Raise unless every vector is exactly ``expected`` wide.

    The startup schema probe compares the *configured* dimension against the
    column. This compares what the model *actually returned*, which is the thing
    that ends up in the database.
    """
    for position, vector in enumerate(vectors):
        width = len(vector)
        if width != expected:
            raise EmbeddingDimensionError(
                f"embedding {position} has {width} dimensions, expected {expected}. "
                f"doc_chunks.embedding is vector({expected}) - either EMBEDDING_MODEL "
                f"and EMBEDDING_DIM disagree, or the column needs an ALTER TABLE and "
                f"a full re-index."
            )


def load_model(model_name: str, device: str | None = None) -> Any:
    """Load and cache the encoder. Safe to call repeatedly.

    Cached at module level because construction means reading ~2 GB of weights;
    doing that per request would dominate ingestion time. In Docker, HF_HOME is
    a named volume so the download survives container replacement.
    """
    global _model, _model_name

    with _load_lock:
        if _model is not None and _model_name == model_name:
            return _model

        from sentence_transformers import SentenceTransformer

        log.info("Loading embedding model %s (first run downloads ~2 GB)", model_name)
        _model = SentenceTransformer(model_name, device=device)
        _model_name = model_name
        log.info(
            "Embedding model ready: %s, %s dimensions",
            model_name,
            _model.get_sentence_embedding_dimension(),
        )
        return _model


def get_model() -> Any:
    if _model is None:
        raise RuntimeError("Embedding model not loaded - call load_model() first.")
    return _model


def is_loaded() -> bool:
    """Whether the encoder is resident, for diagnostics."""
    return _model is not None


def reset_model() -> None:
    """Drop the cached model. Used by tests; also frees the weights."""
    global _model, _model_name
    with _load_lock:
        _model = None
        _model_name = None


def model_dimension(model: Any) -> int | None:
    """The model's own declared width, when it exposes one."""
    getter = getattr(model, "get_sentence_embedding_dimension", None)
    if getter is None:
        return None
    try:
        return int(getter())
    except Exception:  # noqa: BLE001
        return None


def embed_passages(
    texts: Sequence[str],
    *,
    expected_dim: int,
    model: Any = None,
    model_name: str = "",
    batch_size: int = 16,
) -> list[list[float]]:
    """Encode documents for storage, checking every batch before it is returned.

    :param model: injected for tests; defaults to the cached model.
    :raises EmbeddingDimensionError: if any vector is the wrong width.
    """
    return _encode(
        texts, passage_prefix, expected_dim=expected_dim, model=model,
        model_name=model_name, batch_size=batch_size,
    )


def embed_queries(
    texts: Sequence[str],
    *,
    expected_dim: int,
    model: Any = None,
    model_name: str = "",
    batch_size: int = 16,
) -> list[list[float]]:
    """Encode questions for retrieval.

    Separate from :func:`embed_passages` rather than a flag on it, because the
    two are not interchangeable and the failure is silent. e5 wants ``query:``
    here and ``passage:`` there; getting it backwards - or applying the query
    prefix by hand and letting this add the passage prefix on top - still
    returns results, just worse ones, with nothing in the logs to say so.
    """
    return _encode(
        texts, query_prefix, expected_dim=expected_dim, model=model,
        model_name=model_name, batch_size=batch_size,
    )


def _encode(
    texts: Sequence[str],
    prefix_for: Any,
    *,
    expected_dim: int,
    model: Any = None,
    model_name: str = "",
    batch_size: int = 16,
) -> list[list[float]]:
    if not texts:
        return []

    encoder = model if model is not None else get_model()
    name = model_name or _model_name or ""
    prefix = prefix_for(name)

    declared = model_dimension(encoder)
    if declared is not None and declared != expected_dim:
        # Catchable before a single batch is encoded.
        raise EmbeddingDimensionError(
            f"{name or 'model'} produces {declared} dimensions but the column is "
            f"vector({expected_dim})."
        )

    vectors: list[list[float]] = []
    for start in range(0, len(texts), batch_size):
        batch = texts[start : start + batch_size]
        encoded = encoder.encode(
            [prefix + t for t in batch] if prefix else list(batch),
            batch_size=batch_size,
            # Cosine ranking is scale-invariant, so this does not change the
            # ordering - it makes pgvector's 1 - (a <=> b) a true cosine
            # similarity, which is the number the citation UI shows.
            normalize_embeddings=True,
            show_progress_bar=False,
        )
        as_lists = _to_lists(encoded)
        validate_dimensions(as_lists, expected_dim)
        vectors.extend(as_lists)

    return vectors


def _to_lists(encoded: Any) -> list[list[float]]:
    """Normalise whatever the encoder returned into plain nested lists.

    sentence-transformers returns a numpy array; a mock in a test returns lists.
    asyncpg's pgvector codec accepts both, but converting here means the
    dimension check sees one shape and float32 does not reach the driver.
    """
    tolist = getattr(encoded, "tolist", None)
    rows = tolist() if callable(tolist) else encoded
    return [list(row) for row in rows]


def embed_chunks(
    chunks: Sequence[dict],
    *,
    expected_dim: int,
    model: Any = None,
    model_name: str = "",
    batch_size: int = 16,
) -> list[dict]:
    """Attach an ``embedding`` to each chunk dict, in place of a separate list.

    Zips by position, which is safe only because :func:`embed_passages`
    preserves input order; the length assertion below makes that contract
    explicit rather than assumed.
    """
    if not chunks:
        return []

    vectors = embed_passages(
        [c["content"] for c in chunks],
        expected_dim=expected_dim,
        model=model,
        model_name=model_name,
        batch_size=batch_size,
    )
    if len(vectors) != len(chunks):
        raise EmbeddingDimensionError(
            f"encoder returned {len(vectors)} vectors for {len(chunks)} chunks - "
            "refusing to zip them by position."
        )

    for chunk, vector in zip(chunks, vectors):
        chunk["embedding"] = vector
    return list(chunks)


def tokeniser_for(model: Any) -> Any:
    """The model's tokeniser, for an exact ``token_count``.

    Returns ``None`` when unavailable, in which case the chunker keeps its
    whitespace estimate rather than failing.
    """
    tokenizer = getattr(model, "tokenizer", None)
    if tokenizer is None:
        return None

    def count(text: str) -> int:
        try:
            return len(tokenizer.encode(text, add_special_tokens=False))
        except Exception:  # noqa: BLE001
            from app.ingestion.chunker import estimate_tokens

            return estimate_tokens(text)

    return count
