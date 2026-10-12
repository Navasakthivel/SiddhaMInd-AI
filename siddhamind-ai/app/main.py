"""siddhamind-ai - FastAPI service owning OCR, embeddings, retrieval and LLM calls.

Storage is Supabase Postgres with pgvector. The schema, including doc_chunks and
its HNSW index, is owned by siddhamind-core's Flyway migrations - this service
reads and writes, it never issues DDL.
"""

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI

from app.clients import database
from app.config import Settings, get_settings
from app.ingestion import pipeline
from app.routers import explain, ingest, query
from app.security import require_internal_token

settings = get_settings()
logging.basicConfig(
    level=settings.log_level,
    format="%(asctime)s %(levelname)-5s %(name)s - %(message)s",
)
log = logging.getLogger("siddhamind-ai")


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await database.connect(settings)
        probe = await database.health(settings)
        if probe["status"] == "DOWN":
            log.error("Postgres unreachable - %s", probe.get("reason"))
        else:
            schema = probe["schema"]
            if schema["ok"]:
                log.info(
                    "Postgres connected. pgvector %s, doc_chunks.embedding vector(%s), "
                    "%s chunks across %s documents",
                    schema["pgvector"],
                    schema["dimension"],
                    probe["chunks"],
                    probe["sourceDocuments"],
                )
            else:
                # Wrong vector width would fail partway through an ingestion run
                # rather than up front, so it is worth shouting about at boot.
                log.error("Schema check failed: %s", schema["reason"])
    except Exception as exc:  # noqa: BLE001
        # Same stance as siddhamind-core: start anyway and report loudly, so the
        # health endpoint can explain what is wrong.
        log.error("Database initialisation failed: %s: %s", type(exc).__name__, exc)

    if not settings.internal_api_token:
        log.warning("INTERNAL_API_TOKEN is unset - all protected endpoints will return 503.")

    # Fire-and-forget: the first load reads ~2 GB of weights, and awaiting that
    # here would hold the container in an unhealthy state for minutes. Keeping a
    # reference stops the task being garbage-collected mid-flight.
    warmup: asyncio.Task | None = None
    if settings.embedding_warmup:
        warmup = asyncio.create_task(pipeline.warm_embedding_model(settings))

    yield

    if warmup is not None and not warmup.done():
        warmup.cancel()
    await database.close()


app = FastAPI(
    title="SiddhaMind AI",
    description="OCR, embeddings, hybrid retrieval and citation-grounded generation.",
    version="1.0.0",
    lifespan=lifespan,
)

app.include_router(ingest.router)
app.include_router(query.router)
app.include_router(explain.router)


@app.get("/health", tags=["health"])
async def health(cfg: Settings = Depends(get_settings)) -> dict:
    """Unauthenticated so container healthchecks and compose can reach it."""
    try:
        db = await database.health(cfg)
    except Exception as exc:  # noqa: BLE001
        db = {"status": "DOWN", "reason": f"{type(exc).__name__}: {exc}"}

    return {
        "service": cfg.app_name,
        "status": "UP" if db.get("status") == "UP" else "DEGRADED",
        "postgres": db,
        "embedding_model": cfg.embedding_model,
        "embedding_dim": cfg.embedding_dim,
        "auth_configured": bool(cfg.internal_api_token),
    }


@app.get("/internal/ping", tags=["health"], dependencies=[Depends(require_internal_token)])
async def internal_ping() -> dict:
    """Proves the shared-token path works end to end from siddhamind-core."""
    return {"pong": True}


@app.get(
    "/internal/diagnostics",
    tags=["health"],
    dependencies=[Depends(require_internal_token)],
)
async def diagnostics(cfg: Settings = Depends(get_settings)) -> dict:
    """Whether the ingestion stack can actually run, and with which binaries.

    Kept off ``/health`` on purpose: probing Tesseract shells out, and the
    container healthcheck runs every 30 seconds. This is the endpoint to hit
    after installing Tesseract and poppler natively - it names what is missing
    and confirms the Tamil pack is present, which is the difference between
    working OCR and confident nonsense.
    """
    from app.ingestion import embedder, ocr

    binaries = await asyncio.to_thread(
        ocr.check_binaries, cfg.tesseract_cmd, cfg.poppler_path, cfg.tessdata_dir)
    return {
        "ocr": {
            **binaries,
            "tamilPack": "tam" in binaries.get("languages", []),
            "languages": cfg.ocr_languages,
            "minConfidence": cfg.ocr_min_confidence,
            "dpi": cfg.ocr_dpi,
        },
        "embedding": {
            "model": cfg.embedding_model,
            "expectedDim": cfg.embedding_dim,
            "loaded": embedder.is_loaded(),
            "batchSize": cfg.embedding_batch_size,
        },
        "chunking": {
            "size": cfg.chunk_size,
            "overlap": cfg.chunk_overlap,
            "minChars": cfg.chunk_min_chars,
        },
        "paths": {"corpus": cfg.corpus_dir, "upload": cfg.upload_dir},
    }
