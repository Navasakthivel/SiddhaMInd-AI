"""Supabase Postgres connection and the pgvector-backed chunk store.

Replaces the Qdrant client. Chunks, their metadata and their embeddings now live
in one table alongside the relational data, so ingestion and retrieval no longer
have to keep two stores consistent.
"""

import logging
from functools import lru_cache
from typing import Any, Iterable, Sequence
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse

import asyncpg
from pgvector.asyncpg import register_vector

from app.config import Settings

log = logging.getLogger(__name__)

_pool: asyncpg.Pool | None = None


def get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("Database pool not initialised - call connect() during startup.")
    return _pool


def _normalise_dsn(url: str) -> tuple[str, dict[str, Any]]:
    """Split a libpq-style URL into an asyncpg DSN plus connect kwargs.

    asyncpg does not accept ``sslmode`` in the DSN the way psycopg does, and
    Supabase URLs routinely carry it. It also cannot use the SQLAlchemy-style
    ``postgresql+asyncpg://`` prefix.

    Returns the cleaned DSN and any kwargs that must be passed separately.
    """
    if url.startswith("postgresql+asyncpg://"):
        url = url.replace("postgresql+asyncpg://", "postgresql://", 1)
    elif url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)

    parsed = urlparse(url)
    query = parse_qs(parsed.query)

    kwargs: dict[str, Any] = {}

    sslmode = (query.pop("sslmode", [None])[0] or "").lower()
    if sslmode in ("disable", "allow"):
        kwargs["ssl"] = False
    else:
        # Supabase requires TLS. 'require' encrypts without verifying the chain,
        # which matches what sslmode=require means in libpq - asyncpg's default
        # 'prefer' would silently accept plaintext.
        kwargs["ssl"] = "require"

    # PgBouncer in transaction mode hands each statement a different backend, so a
    # prepared statement cached by asyncpg will not exist when it is next used.
    # Supabase's transaction pooler is port 6543.
    if parsed.port == 6543:
        kwargs["statement_cache_size"] = 0
        log.warning(
            "PYTHON_DB_URL points at the transaction pooler (:6543). Disabling the "
            "statement cache. A session connection (:5432) is preferred for ingestion."
        )

    cleaned = urlunparse(parsed._replace(query=urlencode(query, doseq=True)))
    return cleaned, kwargs


_vector_schema: str | None = None


async def _discover_vector_schema(conn: asyncpg.Connection) -> str:
    """Find which schema holds the ``vector`` type.

    ``register_vector`` defaults to ``public``, which is right for a plain
    ``CREATE EXTENSION vector`` but wrong on Supabase: it pre-installs extensions
    into an ``extensions`` schema, so the migration's
    ``CREATE EXTENSION IF NOT EXISTS vector`` is a no-op and the type is
    ``extensions.vector``. asyncpg then fails at pool creation with
    ``ValueError: unknown type: public.vector`` - the pool never initialises, and
    every query afterwards reports "pool not initialised", which points at
    startup order rather than at a schema mismatch.

    Discovered rather than configured so the same code works on Supabase, on a
    vanilla Postgres, and on whatever a future host decides to do.
    """
    schema = await conn.fetchval(
        """
        SELECT n.nspname
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'vector'
        ORDER BY (n.nspname = 'public') DESC
        LIMIT 1
        """
    )
    return schema or "public"


async def _init_connection(conn: asyncpg.Connection) -> None:
    """Register the pgvector codec so embeddings pass as sequences, not strings."""
    global _vector_schema
    if _vector_schema is None:
        _vector_schema = await _discover_vector_schema(conn)
        if _vector_schema != "public":
            log.info("pgvector types live in schema '%s'", _vector_schema)
    await register_vector(conn, schema=_vector_schema)


async def connect(settings: Settings) -> asyncpg.Pool:
    global _pool
    if not settings.python_db_url:
        raise RuntimeError("PYTHON_DB_URL is not set.")

    dsn, kwargs = _normalise_dsn(settings.python_db_url)
    _pool = await asyncpg.create_pool(
        dsn,
        min_size=settings.db_pool_min_size,
        max_size=settings.db_pool_max_size,
        command_timeout=settings.db_command_timeout,
        init=_init_connection,
        **kwargs,
    )
    return _pool


async def close() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def verify_schema(settings: Settings) -> dict:
    """Confirm pgvector is present and the embedding column matches the model.

    A dimension mismatch is otherwise invisible until the first insert fails
    partway through an ingestion run.
    """
    async with get_pool().acquire() as conn:
        extension = await conn.fetchval(
            "SELECT extversion FROM pg_extension WHERE extname = 'vector'"
        )
        if extension is None:
            return {"ok": False, "reason": "pgvector extension is not installed"}

        dimension = await conn.fetchval(
            """
            SELECT a.atttypmod
            FROM pg_attribute a
            JOIN pg_class c ON c.oid = a.attrelid
            WHERE c.relname = 'doc_chunks' AND a.attname = 'embedding'
            """
        )
        if dimension is None:
            return {
                "ok": False,
                "reason": "doc_chunks.embedding does not exist - run the Flyway migration",
            }
        if dimension != settings.embedding_dim:
            return {
                "ok": False,
                "reason": (
                    f"doc_chunks.embedding is vector({dimension}) but "
                    f"{settings.embedding_model} produces {settings.embedding_dim} dimensions"
                ),
            }
        return {"ok": True, "pgvector": extension, "dimension": dimension}


async def health(settings: Settings) -> dict:
    """Round-trip probe used by GET /health."""
    try:
        async with get_pool().acquire() as conn:
            version = await conn.fetchval("SELECT version()")
            chunks = await conn.fetchval("SELECT COUNT(*) FROM doc_chunks")
            documents = await conn.fetchval("SELECT COUNT(*) FROM source_documents")
        schema = await verify_schema(settings)
        return {
            "status": "UP" if schema["ok"] else "DEGRADED",
            "version": version.split(",")[0] if version else None,
            "chunks": chunks,
            "sourceDocuments": documents,
            "schema": schema,
        }
    except Exception as exc:  # noqa: BLE001 - health must report, never raise
        return {"status": "DOWN", "reason": f"{type(exc).__name__}: {exc}"}


# ---------------------------------------------------------------------------
# chunk store
# ---------------------------------------------------------------------------


_CHUNK_COLUMNS = (
    "source_document_id",
    "book_name",
    "page_no",
    "verse_no",
    "chunk_index",
    "content",
    "token_count",
    "embedding",
)

# Rows per INSERT statement.
#
# asyncpg's executemany costs one network round trip PER ROW. That is invisible
# on a local database and ruinous against Supabase: at a measured 410ms median
# RTT, the real corpus book's 159 chunks took 112.9s and blew the 60s command
# timeout. The identical rows as one multi-row INSERT took 2.5s, because the
# cost is a function of statement count, not row count - the server side is
# trivial by comparison (deleting 175 rows takes 0.2s).
#
# Postgres allows 65535 bind parameters per statement, so eight columns cap a
# batch at 8191 rows. 250 stays far under that while keeping a single statement
# near 2.5MB, since each 1024-dimension vector serialises to roughly 10KB of
# text. Any book up to 250 chunks is one round trip; larger ones scale linearly
# in statements rather than in rows.
_INSERT_BATCH_ROWS = 250


@lru_cache(maxsize=16)
def _insert_sql(rows: int) -> str:
    """Build a multi-row INSERT with continuously numbered placeholders.

    Cached because a full ingestion issues the same shape repeatedly: every
    batch but the last has exactly _INSERT_BATCH_ROWS rows.
    """
    width = len(_CHUNK_COLUMNS)
    values = ",".join(
        "(" + ",".join(f"${row * width + col + 1}" for col in range(width)) + ")"
        for row in range(rows)
    )
    return f"INSERT INTO doc_chunks ({', '.join(_CHUNK_COLUMNS)}) VALUES {values}"


async def replace_document_chunks(
    source_document_id: int,
    chunks: Sequence[dict],
) -> int:
    """Delete a document's existing chunks and insert the new set, atomically.

    Re-ingesting a book must not leave a mixture of old and new chunks, which is
    exactly what would happen with an insert-only path. One transaction makes the
    swap all-or-nothing - something the previous two-store design (Qdrant for
    vectors, Firestore for metadata) could not guarantee across both.

    Each chunk dict carries: chunk_index, content, embedding, and optionally
    book_name, page_no, verse_no, token_count.

    :return: number of chunks written
    """
    async with get_pool().acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                "DELETE FROM doc_chunks WHERE source_document_id = $1", source_document_id
            )
            if not chunks:
                return 0
            for start in range(0, len(chunks), _INSERT_BATCH_ROWS):
                batch = chunks[start : start + _INSERT_BATCH_ROWS]
                await conn.execute(
                    _insert_sql(len(batch)),
                    *(
                        value
                        for c in batch
                        for value in (
                            source_document_id,
                            c.get("book_name"),
                            c.get("page_no"),
                            c.get("verse_no"),
                            c["chunk_index"],
                            c["content"],
                            c.get("token_count"),
                            c["embedding"],
                        )
                    ),
                )
            return len(chunks)


async def update_ingest_status(
    source_document_id: int,
    status: str,
    chunk_count: int | None = None,
    skipped_pages: int | None = None,
    error: str | None = None,
) -> None:
    """Report ingestion progress back into the row Java reads.

    Replaces the Firestore metadata sync: both services now write to the same
    table, so there is no cross-store drift to reconcile.
    """
    async with get_pool().acquire() as conn:
        await conn.execute(
            """
            -- $2 is cast explicitly at every use. Without the casts Postgres sees
            -- it assigned to a VARCHAR(20) column and compared to text literals
            -- in the same statement, cannot deduce one type, and rejects the
            -- whole thing with:
            --   AmbiguousParameterError: inconsistent types deduced for $2
            --   DETAIL: text versus character varying
            -- Which fired on the very first status write, so an ingestion could
            -- never leave PENDING - and the FAILED handler hit the identical
            -- error, leaving no record of why.
            UPDATE source_documents
            SET ingest_status   = $2::varchar,
                indexed         = ($2::text = 'COMPLETE'),
                chunk_count     = COALESCE($3, chunk_count),
                skipped_pages   = COALESCE($4, skipped_pages),
                ingest_error    = $5,
                last_indexed_at = CASE WHEN $2::text = 'COMPLETE'
                                       THEN NOW() ELSE last_indexed_at END
            WHERE doc_id = $1
            """,
            source_document_id,
            status,
            chunk_count,
            skipped_pages,
            error,
        )


async def fetch_document(source_document_id: int) -> dict | None:
    async with get_pool().acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT doc_id, slug, title, book_code, language, file_path,
                   total_pages, indexed, chunk_count, ingest_status,
                   ingest_error, skipped_pages
            FROM source_documents
            WHERE doc_id = $1
            """,
            source_document_id,
        )
        return dict(row) if row else None


async def search_dense(
    embedding: Sequence[float],
    limit: int,
    book_names: Iterable[str] | None = None,
    source_document_ids: Iterable[int] | None = None,
) -> list[dict]:
    """Cosine nearest neighbours, with the metadata filtering Qdrant provided.

    ``<=>`` is pgvector's cosine distance, so the HNSW index built with
    vector_cosine_ops is used. Similarity is reported as 1 - distance to match the
    scale the retrieval layer expects.
    """
    filters = ["c.embedding IS NOT NULL"]
    params: list[Any] = [embedding]

    if book_names:
        params.append(list(book_names))
        filters.append(f"c.book_name = ANY(${len(params)})")
    if source_document_ids:
        params.append(list(source_document_ids))
        filters.append(f"c.source_document_id = ANY(${len(params)})")

    params.append(limit)
    sql = f"""
        SELECT c.chunk_id, c.source_document_id, c.book_name, c.page_no,
               c.verse_no, c.chunk_index, c.content,
               1 - (c.embedding <=> $1) AS score
        FROM doc_chunks c
        WHERE {' AND '.join(filters)}
        ORDER BY c.embedding <=> $1
        LIMIT ${len(params)}
    """
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(sql, *params)
    return [dict(r) for r in rows]


async def search_keyword(
    tsquery: str,
    limit: int,
    book_names: Iterable[str] | None = None,
    source_document_ids: Iterable[int] | None = None,
) -> list[dict]:
    """Full-text search, the keyword half of hybrid retrieval.

    Uses the 'simple' configuration rather than 'english': the corpus is mostly
    Tamil, and English stemming would mangle transliterated formulation names -
    which are exactly the terms that need to match exactly.

    Takes a **prepared tsquery expression**, not raw user text, and runs it
    through ``to_tsquery`` rather than ``plainto_tsquery``. The difference
    matters: ``plainto_tsquery`` ANDs every lexeme, and since the 'simple'
    configuration keeps stop words, a question like "what are the ingredients of
    Thiripala Chooranam" became a seven-term conjunction that no chunk could
    satisfy. This half of retrieval returned nothing on every natural-language
    query. Build the expression with
    :func:`app.retrieval.terms.build_tsquery`, which strips stop words and ORs
    what remains.

    Tamil vowel-length folding
    --------------------------
    The content is folded with ``translate`` so that ூ and ு compare equal,
    because Tesseract swaps them freely. ``build_tsquery`` applies the identical
    fold to the query; both sides must fold or neither matches.

    This expression is duplicated in migration V3, which indexes it. Postgres
    only uses an expression index when the query repeats the expression
    character-for-character, and a mismatch does not error - it quietly
    sequential-scans the corpus. Change one and you must change the other.
    """
    filters = ["to_tsvector('simple', translate(c.content, 'ூ', 'ு')) @@ to_tsquery('simple', $1)"]
    params: list[Any] = [tsquery]

    if book_names:
        params.append(list(book_names))
        filters.append(f"c.book_name = ANY(${len(params)})")
    if source_document_ids:
        params.append(list(source_document_ids))
        filters.append(f"c.source_document_id = ANY(${len(params)})")

    params.append(limit)
    sql = f"""
        SELECT c.chunk_id, c.source_document_id, c.book_name, c.page_no,
               c.verse_no, c.chunk_index, c.content,
               ts_rank(to_tsvector('simple', translate(c.content, 'ூ', 'ு')),
                       to_tsquery('simple', $1)) AS score
        FROM doc_chunks c
        WHERE {' AND '.join(filters)}
        ORDER BY score DESC
        LIMIT ${len(params)}
    """
    async with get_pool().acquire() as conn:
        rows = await conn.fetch(sql, *params)
    return [dict(r) for r in rows]
