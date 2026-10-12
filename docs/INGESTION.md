# Ingestion pipeline (Phase 4)

Scanned PDF in, `doc_chunks` rows with 1024-dimension embeddings out.

```
PDF ──> text layer?  ──yes──> use it, no OCR
         │no
         ▼
    rasterise page (poppler, 300 DPI, one page at a time)
         ▼
    OpenCV: greyscale ─> denoise ─> deskew ─> adaptive threshold
         ▼
    Tesseract 5 (tam+eng)  ─> confidence < 45? ─> SKIP + record reason
         ▼
    structure-aware chunking (verse / formulation boundaries)
         ▼
    bge-m3, batched, dimension-checked per batch
         ▼
    replace_document_chunks()  ── one transaction ──> doc_chunks
```

| Module | Responsibility |
|---|---|
| `app/ingestion/ocr.py` | text-layer detection, preprocessing, Tesseract, the confidence gate |
| `app/ingestion/chunker.py` | boundary detection, sliding-window fallback — pure functions |
| `app/ingestion/embedder.py` | cached bge-m3, batching, the dimension guard |
| `app/ingestion/paths.py` | resolving `file_path`, containment guard |
| `app/ingestion/pipeline.py` | orchestration, status transitions |
| `app/routers/ingest.py` | the two HTTP endpoints |

---

## Three design decisions worth knowing

### Structure before windows

A fixed sliding window cuts wherever the character count runs out, which in a
formulary lands mid-formulation about half the time. Retrieval then returns a
fragment whose preparation method belongs to one medicine and whose dose belongs
to the next — worse than a miss, because it reads as coherent.

So entries split on the boundaries the text already has: verse numbers (`236.`,
`236-237.`, `17:14`, `K-01`, Tamil numerals `௨௩௬`) and dosage-form headings
(`… சூரணம்`, `… பற்பம்`). The window is the fallback for prose with no detected
structure.

Section headers *inside* an entry — `செய்முறை`, `அளவு`, `அனுபானம்`, `பத்தியம்` —
are deliberately **not** boundaries. Splitting there strands a dose in a chunk
that never names the medicine it belongs to, so "what is the dose of Thalagam?"
retrieves `அளவு: 100 மி.கி.` with nothing to attach it to.

`structural_ratio` is logged per document. Below 20% the run warns: the scan has
probably lost its line structure, so citations will carry page numbers and no
verse numbers.

### Nothing is dropped without a record

Every page lands in exactly one of three buckets — indexed, skipped-with-a-reason,
or the whole run failed. Four distinct skip reasons, each logged with the page
number and totalled into `source_documents.skipped_pages`:

| Reason | Meaning |
|---|---|
| `OCR confidence N below threshold M` | read, but too poorly to trust |
| `no text recognised - blank page or failed OCR` | Tesseract found no words at all |
| `OCR returned no usable characters` | confident boxes, no surviving glyphs |
| `OCR error: <type>: <message>` | the page threw; the other 399 continue |

Garbled OCR retrieved as a citation is worse than a gap, because the reader has
no way to tell it is wrong. The record is what makes the gap visible.

### The dimension guard runs per batch

The startup probe compares `EMBEDDING_DIM` against the live column. That catches
a misconfiguration but not a model that returns the wrong width partway through a
run. Postgres would reject it — but only at INSERT, after a whole book has been
OCR'd, and the transaction aborts as a unit. Checking every batch fails in
seconds with a message naming the model.

---

## Endpoints

Both require the internal bearer token. `siddhamind-core` is the only caller.

### `POST /ingest/{source_document_id}` → `202 Accepted`

Queues the run and returns immediately — a 400-page book takes tens of minutes,
far past any HTTP timeout.

The cheap failures are checked *before* accepting, so an operator gets an
immediate error instead of having to poll for `FAILED`:

| Status | Cause |
|---|---|
| `404` | no `source_documents` row with that id |
| `409` | that document is already being ingested |
| `400` | `file_path` empty, PDF missing, or resolving outside the corpus root |
| `503` | Tesseract or poppler unavailable on the AI service |

```json
{ "status": "QUEUED", "sourceDocumentId": 1, "file": "Siddha TERM 1 SFI preparations.pdf",
  "totalPages": 46, "poll": "/ingest/1/status" }
```

### `GET /ingest/{source_document_id}/status`

```json
{ "sourceDocumentId": 1, "status": "RUNNING", "running": true, "indexed": false,
  "chunkCount": 0, "skippedPages": 0, "totalPages": 46, "error": null }
```

Reads `source_documents`, so the answer is the one Java's admin page sees.
`running` is the exception — it reflects this process, and distinguishes
"RUNNING and still working" from "RUNNING when the process died", which the row
alone cannot show.

### `GET /internal/diagnostics`

Whether the stack can actually run: Tesseract version, **whether the `tam` pack
is present**, poppler binary path, whether the model is resident. Kept off
`/health` because probing Tesseract shells out and the container healthcheck
runs every 30 seconds.

---

## Running it

### Docker — nothing else to install

The image already has Tesseract 5, the `tam` and `eng` packs, and poppler.
Leave `TESSERACT_CMD` and `POPPLER_PATH` blank.

```bash
docker compose up -d python-ai-service
curl -H "Authorization: Bearer $INTERNAL_API_TOKEN" localhost:8000/internal/diagnostics
```

Give Docker Desktop **at least 4 GB** of memory. torch plus bge-m3 resident
during ingestion exceeds the default on some setups, and the container is
OOM-killed mid-run — which looks like an unexplained restart, not a memory error.

### Native Windows

Python 3.12 is required. `numpy==2.2.1` needs `>=3.10`, so `pip install` fails
outright on 3.9 before any syntax issue arises.

```powershell
py -3.12 -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r siddhamind-ai\requirements.txt
```

For CPU-only machines, install torch from the CPU index first — it saves about
2 GB of CUDA wheels:

```powershell
pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu
```

Two binaries are not pip-installable, and neither installer adds itself to PATH:

| | Where | Note |
|---|---|---|
| Tesseract 5 | [UB-Mannheim build](https://github.com/UB-Mannheim/tesseract/wiki) | **tick Tamil** under *Additional language data* |
| poppler | [poppler-windows releases](https://github.com/oschwartz10612/poppler-windows/releases) | unzip; the binaries are in `Library\bin` |

Then in `.env`:

```
TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe
POPPLER_PATH=C:\poppler-24.08.0\Library\bin
```

Confirm with `/internal/diagnostics` — specifically `"tamilPack": true`. Without
it, Tamil pages OCR through the English model and produce *confident nonsense*,
which the confidence gate cannot catch because the scores look fine.

---

## Tests

```bash
cd siddhamind-ai && pytest -q
```

The chunker, OCR gate, embedder guard and path containment suites (100 tests)
need **no PDF, no Tesseract, no torch and no database** — third-party imports are
lazy specifically so this stays true. The integration suite skips with a reason
naming what is missing.

To exercise the real path, drop a PDF in `corpus/` and:

```bash
pytest tests/test_ingestion_integration.py -v -s
```

The first test always runs and prints what is available, so a fully skipped run
still explains itself.

---

## The synthetic smoke-test fixture

`corpus/test-sample.pdf` is a committed 4-page fixture, one page per pipeline
branch. It carries no licensed content, so unlike the real corpus it is not
gitignored.

| Page | Content | Exercises | Expected |
|---|---|---|---|
| 1 | English, native PDF text | text-layer path, structural split | 4 chunks, verses `101` `102` `103` |
| 2 | Tamil, image + invisible text | verse-boundary detection | 3 chunks, verses `42` `43` `௪௪` |
| 3 | Mixed prose, no markers | sliding-window fallback | 2 chunks, no verse, ~150 char overlap |
| 4 | Image only, **no text layer** | OCR path | must reach Tesseract, not the text layer |

Page 4 contains the line `SCANNED PAGE - NO TEXT LAYER`, which appears nowhere
in any text layer in the document. If that string turns up in a chunk, it came
through Tesseract — that is the proof, not the logs.

Inspect how it chunks without a database or a model:

```bash
python scripts/inspect_chunks.py corpus/test-sample.pdf
```

Regenerate it with `python scripts/make_test_pdf.py`. That step is **Windows-only**:
neither reportlab nor Pillow-on-Windows shapes complex scripts, so `நிலவேம்பு`
renders as `நிலவமேபு` — the vowel sign `ே` must be reordered before the consonant
it follows logically. The generator therefore rasterises pages 2–4 through
Windows GDI+, which shapes correctly, and overlays an invisible text layer
(render mode 3) on pages 2–3. That is also how a real digitised book is built.

> The fixture proves the *plumbing*: branch selection, boundary detection,
> window overlap, chunk indexing. It cannot tell you how Tesseract performs on
> a real scan — clean font rendering is a far easier target than a photographed
> page of a 1968 print. Only a real Siddha PDF answers that.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `503` with `pdftoppm not found` | poppler binary missing | Install poppler; set `POPPLER_PATH` to its `Library\bin` |
| `tesseract is not installed or it's not in your PATH` | Tesseract missing | Install it; set `TESSERACT_CMD` |
| Every page skipped, confidence ~10 | no `tam` pack | Reinstall Tesseract with Tamil ticked |
| Confident output, meaningless Tamil | `tam` pack missing, English model used | Same fix — check `"tamilPack": true` |
| `skipped_pages` high on a clean scan | threshold too strict for the typeface | Lower `OCR_MIN_CONFIDENCE`, re-ingest, compare |
| `structural ratio 0%` warning | OCR lost the line structure | Raise `OCR_DPI`; citations fall back to page numbers |
| `embedding N has 384 dimensions` | model and column disagree | Set `EMBEDDING_MODEL` back to a 1024-d model, or `ALTER TABLE` + re-index |
| Container restarts mid-ingestion | OOM | Give Docker ≥4 GB |
| First ingestion hangs for minutes | downloading bge-m3 (~2 GB) | Expected once; `hf_cache` volume keeps it |
| `409 already being ingested` | a run is in flight | Wait, or poll the status endpoint |
| `400 ... outside the corpus` | `file_path` escapes the corpus root | Correct `source_documents.file_path` |

---

## Deliberately not built here

**Celery/Redis.** FastAPI `BackgroundTasks` is enough for a corpus of a few dozen
books ingested once. Celery would buy retries and cross-process visibility at the
cost of a broker, a worker image and a second deployment target. Redis is already
in compose for Phase 5 caching; if the corpus grows past a few dozen books, the
swap is `pipeline.ingest_document` unchanged behind a task decorator.

**Retrieval and Gemini.** Phase 5. `search_dense()` and `search_keyword()` already
exist in `app/clients/database.py`; reciprocal rank fusion and citation-grounded
generation are not written. `embedder.query_prefix()` is defined alongside
`passage_prefix()` because using one without the other is a silent quality loss —
every query still returns results, they are just worse.
