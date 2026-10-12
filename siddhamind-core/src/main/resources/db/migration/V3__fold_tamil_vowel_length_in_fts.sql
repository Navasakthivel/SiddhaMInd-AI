-- Fold Tamil vowel-length in the full-text index.
--
-- Tesseract confuses U+0BC2 (ூ) with U+0BC1 (ு) constantly on the Siddha corpus:
-- they differ by a small loop, and document 2 carries 3035 instances of ு
-- against 265 of ூ with misreads in both directions. The indexed text and a
-- reader's query therefore disagree on words that look identical on screen, and
-- the keyword half of hybrid retrieval returns nothing.
--
-- Folding was measured before being applied: collapsing the two signs merged
-- zero distinct words across 5025 real corpus tokens. The consonant pairs OCR
-- also confuses (ச/த, ம/ற, ந/த) are deliberately NOT folded - they failed the
-- same test, colliding genuinely different words.
--
-- The fold lives in the index expression, not in the stored content. Rewriting
-- doc_chunks.content would turn the corpus into a misspelling of itself and
-- show the wrong spelling to practitioners; only the comparison is folded.
--
-- This expression MUST stay character-for-character identical to the one in
-- app.clients.database.search_keyword. An expression index is only used when
-- the query repeats the expression exactly, and a mismatch does not fail - it
-- silently falls back to a sequential scan over the whole corpus.
DROP INDEX IF EXISTS ix_chunks_content_fts;

CREATE INDEX ix_chunks_content_fts ON doc_chunks
    USING gin (to_tsvector('simple', translate(content, 'ூ', 'ு')));
