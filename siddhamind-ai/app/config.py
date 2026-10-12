"""Environment-driven settings for siddhamind-ai."""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "siddhamind-ai"
    environment: Literal["dev", "prod"] = "dev"
    log_level: str = "INFO"

    # --- Service-to-service auth -------------------------------------------
    # Shared bearer token presented by siddhamind-core on every protected call.
    # Empty means "reject everything": failing closed is the only safe default
    # for an unset credential.
    internal_api_token: str = ""

    # --- Supabase Postgres --------------------------------------------------
    # PYTHON_DB_URL. Prefer a SESSION-mode connection (direct :5432, or the
    # session pooler on :5432). The transaction pooler on :6543 works only with
    # statement caching disabled, which this service detects and handles - but
    # bulk COPY-style ingestion is materially faster on a session connection.
    python_db_url: str = ""

    db_pool_min_size: int = 1
    db_pool_max_size: int = 5
    db_command_timeout: float = 60.0

    # --- Embeddings ---------------------------------------------------------
    # BAAI/bge-m3 produces 1024-dimension dense vectors. So does
    # intfloat/multilingual-e5-large, so either fits doc_chunks.embedding
    # without a migration. A model of different width needs an ALTER TABLE and a
    # full re-index; the startup check refuses to run on a mismatch.
    embedding_model: str = "BAAI/bge-m3"
    embedding_dim: int = 1024

    # --- Gemini (Phase 5) ---------------------------------------------------
    gemini_api_key: str = ""

    # A pinned id, never an alias. gemini-flash-latest resolves to whatever
    # Google currently calls latest, so the model behind the citation-grounded
    # prompt could change with no diff in this repo. Prompt adherence is the
    # safety property here - the model is trusted to answer only from the
    # supplied passages and never to invent a dose - so that swap must be a
    # deliberate edit, not a silent upstream event.
    gemini_model: str = "gemini-3.6-flash"

    # --- Corpus paths -------------------------------------------------------
    corpus_dir: str = "../corpus"
    upload_dir: str = "../uploads"

    # --- OCR ----------------------------------------------------------------
    ocr_languages: str = "tam+eng"
    ocr_min_confidence: float = 45.0

    # 300 DPI is the resolution Tesseract is trained for. Below ~200 accuracy
    # falls off sharply on Tamil; above 400 costs memory for no gain.
    ocr_dpi: int = 300

    # A page with at least this many extractable characters is treated as having
    # a real text layer and is never rasterised. Born-digital pages still carry a
    # few stray characters (headers, page numbers) after a failed embed, so the
    # threshold is well above zero.
    text_layer_min_chars: int = 120

    # Minimum share of Tamil letters before an embedded text layer is trusted on
    # a document declared Tamil or mixed.
    #
    # Character count alone is not proof of a usable text layer. Legacy Tamil DTP
    # fonts - SunAnand, Bamini, TSCII-family, TAU/Elango - map glyphs through
    # WinAnsiEncoding with no ToUnicode CMap, so the page displays Tamil while
    # the stored codepoints are Latin: மருந்தாக்கவியல் extracts as
    # "kUe;jhf;ftpay;". Long, text-shaped, and meaningless. Tesseract reads the
    # rendered glyphs and returns correct Unicode, so those pages must go to OCR.
    text_layer_min_tamil_ratio: float = 0.30

    # Binary locations. Empty means "look on PATH", which is what the Docker image
    # provides. Set these when running natively on Windows, where the installers
    # do not add themselves to PATH:
    #   TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe
    #   POPPLER_PATH=C:\poppler\Library\bin
    tesseract_cmd: str = ""
    poppler_path: str = ""

    # Language-pack directory, exported as TESSDATA_PREFIX. Blank uses whatever
    # Tesseract was built with, which is what the Docker image wants.
    #
    # Needed on Windows because the packs live under C:\Program Files, which an
    # unelevated installer cannot write to - so adding Tamil means keeping the
    # traineddata somewhere the user owns and pointing Tesseract there. Every
    # language in OCR_LANGUAGES must be in this one directory, eng included.
    tessdata_dir: str = ""

    # --- Chunking -----------------------------------------------------------
    chunk_size: int = 900
    chunk_overlap: int = 150

    # Below this a chunk is noise - a page number, a running header, an OCR
    # fragment. Embedding it wastes a row and pollutes retrieval.
    chunk_min_chars: int = 60

    # --- Embedding ----------------------------------------------------------
    # Chosen for CPU inference. Raising it helps on a GPU and hurts on a laptop,
    # where it mostly increases peak memory.
    embedding_batch_size: int = 16

    # Preload the encoder at startup so the first ingestion does not pay the
    # load. Done off the event loop and never blocking readiness - see
    # pipeline.warm_embedding_model. Turn off on a memory-constrained box that
    # only ever serves /health.
    embedding_warmup: bool = True

    # --- Gemini generation --------------------------------------------------
    # Low temperature: the task is to restate what the passages say, not to
    # write. Anything higher mainly buys paraphrase drift away from the source.
    gemini_temperature: float = 0.2

    # Measured, not guessed. Newer flash models spend "thinking" tokens that come
    # out of this same budget: at top_k=6 passages of passage_max_chars=1600,
    # three identical calls used 550 / 718 / 868 reasoning tokens plus ~160 of
    # output. A 1024 budget left 19% headroom on the worst run, and overrunning
    # returns finishReason=MAX_TOKENS with EMPTY text - which would surface as
    # "assistant unavailable", a config fault dressed as an outage. A cap is not
    # a reservation, so the unused headroom costs nothing.
    gemini_max_output_tokens: int = 4096

    # --- Retrieval ----------------------------------------------------------
    top_k: int = 6

    # Rows pulled from each retriever before fusion. Deeper than top_k on
    # purpose: RRF's signal is which passages *both* methods ranked highly, and
    # two six-row lists barely overlap.
    retrieval_candidates: int = 24

    # RRF damping. 60 is the value from the original Cormack et al. paper and
    # behaves well without corpus-specific tuning: it keeps the gap between
    # adjacent ranks small, so agreement between retrievers outweighs one
    # retriever's confidence.
    rrf_k: int = 60

    # The "not found in corpus" threshold, applied to cosine similarity - which
    # is absolute and comparable across queries, unlike ts_rank or a fused RRF
    # score. Raise it if the assistant answers questions the corpus does not
    # really cover; lower it if it refuses questions it should handle.
    dense_score_floor: float = 0.35

    # Per-passage truncation in the prompt, and the stored citation snippet.
    passage_max_chars: int = 1600
    citation_snippet_chars: int = 320


@lru_cache
def get_settings() -> Settings:
    return Settings()
