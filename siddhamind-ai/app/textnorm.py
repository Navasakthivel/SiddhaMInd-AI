"""Text normalisation shared by indexing and querying.

Both sides must apply the *same* transformation or retrieval silently misses:
what is written into ``doc_chunks.content`` has to be comparable with what a
question is tokenised into. Keeping it in one module rather than a regex copied
into each is the point - two copies drift, and the symptom is a search that
quietly returns nothing for a term that is visibly present in the text.

stdlib only, so both ``app.ingestion`` and ``app.retrieval`` can use it.
"""

from __future__ import annotations

import re
import unicodedata

# Zero-width and other default-ignorable characters. Tesseract emits ZWNJ
# liberally after Tamil word-final consonants - the OCR'd form of குடிநீர்
# carries a trailing U+200C that the same word read from a PDF text layer does
# not. Both look identical on screen and compare unequal, so a keyword search
# for the word matches one source and not the other.
#
# ZWJ is stripped alongside it. In Tamil it only ever requests a ligature form,
# which is a rendering hint rather than a distinction in meaning, so removing it
# cannot merge two words that a reader would consider different. Soft hyphen and
# BOM are here because PDF extraction produces both.
_INVISIBLE = re.compile(
    "["
    "​"  # ZERO WIDTH SPACE
    "‌"  # ZERO WIDTH NON-JOINER   <- the Tesseract artefact
    "‍"  # ZERO WIDTH JOINER
    "⁠"  # WORD JOINER
    "﻿"  # ZERO WIDTH NO-BREAK SPACE / BOM
    "­"  # SOFT HYPHEN
    "]"
)


def strip_invisibles(text: str) -> str:
    """Remove zero-width and default-ignorable characters."""
    return _INVISIBLE.sub("", text or "")


# U+0BC2 TAMIL VOWEL SIGN UU -> U+0BC1 TAMIL VOWEL SIGN U.
#
# Tesseract confuses these two constantly on this corpus: they differ only by a
# small loop, and document 2 carries 3035 instances of ு against 265 of ூ, with
# misreads in both directions. A reader cannot tell சூரணம் from சுரணம் matters;
# Postgres compares bytes and returns nothing.
#
# The visually similar consonant pairs OCR also confuses (ச/த, ம/ற, ந/த) are
# NOT folded: they failed the same test, because folding them collides
# genuinely different words.
#
# KNOWN, ACCEPTED IMPRECISION - deferred 2026-08-09, not an oversight
# ------------------------------------------------------------------
# The original "zero false merges" result was measured on document 2 alone.
# Re-measured across three documents (6254 distinct Tamil words) it no longer
# holds: 14 fold groups form, of which
#
#   8  are genuine OCR-variant merges  (கல்வத்திலிட்டூப், பூரக்கட்டூ, ...)
#   3  merge two line-break fragments, neither of them a word (கு/கூ, சு/சூ,
#      புர/பூர) - harmless and worthless
#   3  are real collisions: பு/பூ (பூ = flower), முன்/மூன், and முட்டு/மூட்டு,
#      where மூட்டு is the ordinary word for a joint and a likely query term
#
# A measured fix exists and is deliberately NOT applied. Every collision differs
# in the *first* syllable and almost every safe merge in a later one, so folding
# everywhere except the first syllable removes all three collisions and all
# three junk merges while keeping 7 of the 8 real ones.
#
# It was declined on cost, not correctness: `translate` cannot express a
# positional rule, so the SQL half needs a protect-fold-restore kept
# character-identical to this, which means a migration to rebuild the GIN index
# plus a full re-ingest of every document. The collision is recall-side only -
# it adds retrieval candidates, which still have to survive RRF fusion, the
# dense relevance floor and citation-only generation before a reader sees
# anything. That is categorically weaker than a wrong verse_no, which is
# asserted to the reader as fact and is what forced the citation rule in
# chunker.has_citation.
#
# Revisit when the corpus next needs a migration anyway, or if a joint-pain
# query is observed retrieving முட்டுவாழை.
_VOWEL_LENGTH_FOLD = str.maketrans({"ூ": "ு"})

# The SQL half of the same fold, for the content side of a keyword search. It
# must stay character-for-character identical to _VOWEL_LENGTH_FOLD: the query
# and the text are only comparable if both are folded the same way.
SQL_VOWEL_LENGTH_FOLD = ("ூ", "ு")


def fold_vowel_length(text: str) -> str:
    """Collapse ூ to ு for *matching only*.

    Deliberately not part of :func:`normalise`. Normalisation runs at index
    time and its output is what gets stored and shown; folding there would
    rewrite the corpus into a misspelling of itself. This is a comparison-time
    transformation applied to both sides of a search and to neither side of
    storage.
    """
    return (text or "").translate(_VOWEL_LENGTH_FOLD)


def normalise(text: str) -> str:
    """NFC-compose, then drop invisible characters.

    NFC first: OCR emits Tamil vowel signs decomposed inconsistently, so the
    same word can arrive as two different byte sequences. Postgres full-text
    search compares bytes and an embedding model tokenises them differently, so
    both halves of hybrid retrieval would miss.

    Invisibles second, because composition can leave them untouched in the
    middle of an otherwise-normalised cluster.
    """
    if not text:
        return ""
    return strip_invisibles(unicodedata.normalize("NFC", text))
