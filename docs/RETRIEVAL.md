# Retrieval and citation-grounded generation (Phase 5)

```
question
   ↓ embed with bge-m3 (the same cached model that embedded the corpus)
   ├─────────────────────┬───────────────────────────
   ↓ dense: cosine <=>   ↓ keyword: to_tsquery, OR-joined
   ↓ 24 candidates       ↓ 24 candidates
   └──────────┬──────────┘
              ↓ reciprocal rank fusion (k=60)
              ↓ top 6
              ↓ RELEVANCE GATE ──not relevant──> "not found in corpus", no LLM call
              ↓ relevant
              ↓ numbered-passage prompt → Gemini
              ↓ parse [n] citations back to passages
   answer + citations
```

| Module | Responsibility |
|---|---|
| `app/retrieval/terms.py` | question → tsquery (stop words out, OR in) |
| `app/retrieval/fusion.py` | RRF, and the relevance gate |
| `app/retrieval/prompt.py` | numbered-passage prompt, citation parsing |
| `app/retrieval/answering.py` | gate → generate → cite. **No I/O imports** |
| `app/retrieval/service.py` | embedding and both searches |
| `app/clients/gemini.py` | the only LLM call in the system |
| `app/routers/query.py` | `POST /query` |

---

## The response contract

`POST /query`, bearer token required. Consumed by `AssistantApiController`.

```json
{
  "answer": "Thiripala Chooranam contains Kadukkai 35 g, Thandrikkai 35 g and Nellikkai 35 g [1].",
  "citations": [
    { "passageNo": 1, "chunkId": 42, "sourceDocumentId": 7,
      "bookName": "Synthetic Test Document", "pageNo": 1, "verseNo": "101",
      "chunkIndex": 1, "snippet": "101. Thiripala Chooranam...", "score": 0.0328 }
  ],
  "notFoundInCorpus": false,
  "retrievalCount": 6,
  "reason": "top similarity 0.812 at or above the 0.35 floor",
  "diagnostics": { "tsquery": "ingredients | thiripala | chooranam", "...": "..." }
}
```

Citation fields mirror `ChatMessageCitation` **field for field**, so Phase 6 maps
straight onto the entity with no translation layer. `reason` and `diagnostics` are
additions Java can ignore; without them a "not found" is indistinguishable from a
broken index.

A `notFoundInCorpus` response is **HTTP 200**, not 404. It is the correct final
answer, not a failure to retry. Generation failing — missing key, blocked
response, SDK error — is a **502**, because that is a different problem with a
different fix.

---

## Three decisions worth knowing

### RRF fuses rankings, not scores

Cosine similarity and `ts_rank` are not on the same scale and never will be: one
is bounded in [-1, 1] and metric, the other is an unbounded function of term
frequency and document length. Normalising them against each other means picking
a weight that is really a guess, and re-guessing it whenever the corpus changes.

RRF ignores the magnitudes and fuses the orderings — the part both methods agree
on the meaning of. `score = Σ 1/(k + rank)`, `k = 60`. A passage both retrievers
rank highly beats one that a single retriever ranked first, which is the intent:
agreement between two different notions of relevance is stronger evidence than
one method's confidence.

Ties break on `chunk_id` ascending. Without that the order would follow dict
iteration and the same question could cite different sources on different runs.

Each retriever is asked for **24** candidates, not 6. Fusing two six-row lists
gives RRF almost nothing to work with.

### The gate is on cosine similarity, not on the RRF score

RRF is `1/(k+rank)`, so the top result scores identically whether it is a perfect
match or the least bad of six irrelevant ones. A threshold on it would measure
ordering, not relevance. Cosine similarity is absolute and comparable across
queries, so `DENSE_SCORE_FLOOR=0.35` means something.

An exact full-text match **bypasses** the floor. `ts_rank` is only meaningful
within one query so it gets no threshold, but the *existence* of a match is
decisive — and this is the arm that protects exact Tamil formulation names and
verse numbers like `௪௪`, where the dense vector for a short rare token is often
mediocre while an exact term match is conclusive.

Two independent defences, not one:

1. **The gate** stops the model being called with nothing relevant.
2. **The prompt** stops it answering from training data when passages are present
   but do not cover the question.

The gate is structural — on the not-found path the generator is never even
constructed, so there is no code path to an LLM. That is asserted directly, with
a factory that raises if invoked.

### The model returns integers, not citations

The prompt numbers each passage and asks for `[1]`, `[2][3]`. Those numbers are
resolved against the passages actually sent; book names, pages and verse numbers
come from the local lookup, never from the model.

That asymmetry is the point. A hallucinated page number is indistinguishable from
a real one to a reader. A hallucinated *passage number* is just an integer that
fails to resolve — it gets dropped, counted into `diagnostics.invalidPassageNumbers`
and logged. Bare numbers in prose are ignored, so "boil for 3 minutes" never
becomes a citation of passage 3.

---

## Two defects this phase fixed

**`search_keyword` matched nothing, ever.** It used `plainto_tsquery`, which ANDs
every lexeme — and because the index uses the `simple` configuration, which has no
stop-word list, nothing was dropped. "what are the ingredients of Thiripala
Chooranam" became a seven-term conjunction no chunk could satisfy. The keyword
half of hybrid retrieval was returning zero rows on every natural-language
question, silently. Queries are now built by `terms.build_tsquery`: stop words
removed, remainder ORed, `ts_rank` left to reward passages matching more of them.

**Tamil words were being shredded into fragments.** Python's `\w` matches
alphanumerics, and Tamil vowel signs are combining marks — `'ே'.isalnum()` is
`False`. A plain `\w+` tokeniser treated every vowel sign as a word boundary, so
`நிலவேம்பு` became `ந | லவ | ம | ப`, destroying keyword search for exactly the
Tamil names it exists to catch. The token class now covers the Tamil block and
the combining diacriticals.

---

## Tuning

| Setting | Default | Raise it when | Lower it when |
|---|---|---|---|
| `DENSE_SCORE_FLOOR` | 0.35 | it answers things the corpus doesn't cover | it refuses questions it should handle |
| `TOP_K` | 6 | answers miss context spread over many entries | the model wanders across irrelevant passages |
| `RETRIEVAL_CANDIDATES` | 24 | fusion looks arbitrary on a large corpus | retrieval latency matters more than recall |
| `RRF_K` | 60 | one retriever dominates unhelpfully | you want rank-1 to carry more weight |
| `GEMINI_TEMPERATURE` | 0.2 | — | answers drift from the passage wording |

The floor is the one to touch first, and `diagnostics.bestDenseScore` on a
refused question tells you what to set it to.

---

## Testing

```bash
cd siddhamind-ai && pytest -q
```

The fusion, gate, terms, prompt and answering suites need **no key, no database
and no model** — `answering.py` imports nothing that requires installing,
specifically so the "never call the model ungrounded" guarantee is verifiable
anywhere.

`tests/test_query_integration.py` layers up as prerequisites appear:

| Available | What runs |
|---|---|
| `PYTHON_DB_URL` + embedded chunks | hybrid retrieval, keyword-arm regression, the gate end to end |
| the above + `GEMINI_API_KEY` | generation, citation resolution against real content |

---

## Not built here

**Cross-encoder reranking.** Scoped out until RRF is shown to order badly on real
content — a reranker adds a second model load and per-query inference, and tuning
it against a corpus of nine synthetic chunks would be fitting to noise.

**Query caching.** Redis is in compose for it. Not worth adding before there is a
real query load to measure.
