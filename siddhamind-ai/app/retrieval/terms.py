"""Turning a natural-language question into a Postgres tsquery.

Pure functions - no database.

The problem this solves
----------------------
``plainto_tsquery`` ANDs every lexeme it produces. For a question like

    what are the ingredients of Thiripala Chooranam

it builds ``'what' & 'are' & 'the' & 'ingredients' & 'of' & 'thiripala' &
'chooranam'`` - and because the index uses the ``simple`` configuration, which
has no stop-word list, none of those terms are dropped. No chunk in any corpus
contains all seven, so the keyword half of hybrid retrieval returns nothing on
every natural-language question. It only ever worked for queries that were
already exactly a phrase from the text.

That silently disables the arm of retrieval that exists specifically to catch
exact Tamil formulation names and verse numbers, which is the case dense
embeddings are weakest on. So the query is rebuilt here: stop words removed,
remaining terms ORed, and ``ts_rank`` left to reward the passages that match
more of them.
"""

from __future__ import annotations

import re
from typing import Iterable

from app import textnorm

# Question and function words. Removed because the 'simple' text-search
# configuration keeps them - it lowercases and nothing else - so ORing them in
# would match essentially every chunk and make ts_rank meaningless.
STOP_WORDS: frozenset[str] = frozenset(
    {
        # English
        "a", "about", "all", "an", "and", "any", "are", "as", "at", "be", "been",
        "between", "but", "by", "can", "could", "did", "do", "does", "for", "from",
        "get", "give", "had", "has", "have", "how", "i", "if", "in", "is", "it",
        "its", "list", "many", "me", "much", "my", "no", "not", "of", "on", "one",
        "or", "please", "show", "so", "some", "tell", "than", "that", "the",
        "their", "them", "then", "there", "these", "they", "this", "those", "to",
        "up", "use", "used", "was", "we", "were", "what", "when", "where",
        "which", "who", "why", "will", "with", "would", "you", "your",
        # Tamil question and function words
        "என்ன", "எது", "எவை", "எப்படி", "ஏன்", "எங்கே", "எப்போது", "யார்",
        "ஆகிய", "மற்றும்", "இது", "அது", "இந்த", "அந்த", "ஒரு", "உள்ள",
        "உள்ளது", "என்று", "என", "பற்றி", "கூறு", "சொல்",
    }
)

# Python's ``\w`` is Unicode-aware but matches only alphanumerics, and combining
# marks are neither: ``'ே'.isalnum()`` is False. Tamil writes its vowel signs as
# combining marks, so a plain ``\w+`` treats every one of them as a token
# boundary and shreds நிலவேம்பு into ந / லவ / ம / ப - destroying keyword search
# for precisely the Tamil formulation names it exists to catch. The Tamil block
# is therefore included wholesale, plus the combining diacriticals used by
# transliterated Latin.
_TAMIL_BLOCK = "஀-௿"
_COMBINING = "̀-ͯ"
_WORD = rf"\w{_TAMIL_BLOCK}{_COMBINING}"

_TOKEN = re.compile(rf"[{_WORD}]+", re.UNICODE)
# Anything outside a word character, plus the underscore that ``\w`` lets in.
_UNSAFE = re.compile(rf"[^{_WORD}]|_", re.UNICODE)


# Confirmed whole-word OCR corrections, applied to query terms only.
#
# This exists for the confusions that vowel-length folding does not cover: ச/த,
# ம/ற and ந/த are visually similar and Tesseract swaps them, but folding those
# letters wholesale collides genuinely different words (ச appears 1278 times and
# த 2590 in document 2, in unrelated vocabulary). A dictionary of individually
# confirmed pairs gets the recall without the collisions.
#
# Corrections run BEFORE folding, so an entry may be written in its natural
# spelling; both sides collapse to the same folded form afterwards.
CORRECTIONS: dict[str, str] = {
    "சுரணம்": "சூரணம்",
}

# Tamil writes a syllable as a base letter plus optional vowel sign or virama,
# so a "character" in the Python sense is not a unit of the script: வெள் is four
# codepoints but two syllables. Prefix length is counted in syllables.
_AKSHARA_MARK = re.compile(rf"[ா-ௗ{_COMBINING}]")

# Minimum syllables before a term may be prefix-matched. Measured on the real
# corpus vocabulary (2322 distinct Tamil words across documents 2 and 7):
# appending ``:*`` to a whole term of this length produced zero spurious
# matches. A one- or two-syllable term is a morpheme rather than a word - வெள்
# alone opens வெள்ளி (silver), வெள்ளீயம் (tin), வெள்வங்கம் (zinc) and
# வெள்ளாட்டுப்பால் (goat's milk), which are four different substances.
MIN_PREFIX_AKSHARAS = 3


def aksharas(word: str) -> list[str]:
    """Split into Tamil syllable clusters: a base letter plus its marks."""
    out: list[str] = []
    for ch in word or "":
        if out and _AKSHARA_MARK.match(ch):
            out[-1] += ch
        else:
            out.append(ch)
    return out


def is_prefixable(term: str) -> bool:
    """Whether a term may carry ``:*``.

    A number never may. Verse and page references are exact: ``236:*`` also
    matches 2360 and 2367, so prefixing one would answer a question about verse
    236 with a different verse entirely. Tamil numerals are excluded by the same
    test, since they are digits rather than letters to Unicode.
    """
    if not any(ch.isalpha() for ch in term):
        return False
    return len(aksharas(term)) >= MIN_PREFIX_AKSHARAS


def tokenise(text: str) -> list[str]:
    """Split into word tokens, keeping Tamil words whole.

    The same :func:`app.textnorm.normalise` the indexer applies runs first, so a
    question and the chunks it searches are compared in one form. Without it a
    query pasted from an OCR'd source would carry zero-width characters the
    indexed text no longer has - and the term would tokenise differently and
    match nothing.

    Punctuation and tsquery operators (``& | ! ( ) : *``) cannot survive, since
    none of them are word characters.
    """
    return [t.lower() for t in _TOKEN.findall(textnorm.normalise(text or ""))]


def meaningful_terms(text: str, *, min_length: int = 2) -> list[str]:
    """Query terms worth searching for, de-duplicated, order preserved.

    Single characters are dropped unless they are digits or non-Latin - a lone
    Tamil numeral like ``௪`` is a legitimate verse reference, whereas a stray
    Latin ``a`` is not.
    """
    seen: set[str] = set()
    out: list[str] = []
    for token in tokenise(text):
        if token in STOP_WORDS or token in seen:
            continue
        if len(token) < min_length and token.isalpha() and token.isascii():
            continue
        seen.add(token)
        out.append(token)
    return out


def build_tsquery(text: str, *, min_length: int = 2, prefix: bool = True) -> str | None:
    """An OR-joined tsquery string, or ``None`` when nothing is worth searching.

    Safe to pass to ``to_tsquery`` as a bound parameter: every term comes from
    a ``\\w+`` match and is stripped again below, so no tsquery operator can
    survive into the expression. ``:*`` is appended *after* that stripping,
    which is the only way an operator enters the expression.

    ``None`` means the question was entirely stop words. The caller must skip
    the keyword search rather than pass an empty string, which ``to_tsquery``
    rejects.

    Terms are corrected, then folded, then prefix-marked. The folding must be
    mirrored on the content side by the SQL in
    :func:`app.clients.database.search_keyword`, or nothing matches.

    On ``prefix``
    -------------
    A term is prefix-matched **whole** - never truncated to a stem. Truncating
    is what a reader expects "prefix search" to mean, and it is unsafe here:
    cutting the real corpus vocabulary to two syllables produced 3.99 spurious
    matches per query against 2.17 genuine ones, and the spurious set is full of
    substance confusions - வெள்ளி (silver) against வெள்வங்கம் (zinc) against
    வெள்ளீயம் (tin). Left whole, the same vocabulary produced **zero** spurious
    matches, because a word that starts with an entire other word shares its
    stem by construction.

    What that buys is the direction where the reader types a stem: ``சூரண``
    now finds ``சூரணம்``. It does **not** fix the opposite direction - a query
    for ``சூரணம்`` still misses the inflected ``சூரணத்துடன்`` in the text,
    because Tamil inflection replaces the stem-final ``ம்`` rather than
    appending to it. That needs a stemmer, not a prefix, and dense retrieval
    already covers it.
    """
    out: list[str] = []
    for term in meaningful_terms(text, min_length=min_length):
        term = CORRECTIONS.get(term, term)
        term = _UNSAFE.sub("", textnorm.fold_vowel_length(term))
        if not term:
            continue
        if prefix and is_prefixable(term):
            term += ":*"
        out.append(term)
    if not out:
        return None
    return " | ".join(out)


def matched_terms(content: str, terms: Iterable[str]) -> list[str]:
    """Which query terms actually appear in a passage. For logging and debugging.

    Substring rather than token matching, deliberately: Tamil is agglutinative,
    so a query term is frequently a prefix of the inflected form in the text
    (``சூரணம்`` inside ``சூரணத்தை``), and requiring a whole-token match would
    report a miss where a reader sees an obvious hit.
    """
    lowered = (content or "").lower()
    return [t for t in terms if t and t in lowered]
