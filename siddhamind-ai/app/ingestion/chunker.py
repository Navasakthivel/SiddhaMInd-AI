"""Structure-aware chunking for Siddha texts.

Pure functions only - no PDF, no database, no model. Everything here takes page
text plus metadata and returns dicts shaped for ``doc_chunks``, which is what
makes the retrieval quality of this stage testable in isolation.

Why structure first
-------------------
A fixed sliding window cuts wherever the character count runs out, which in a
formulary lands mid-formulation about as often as not. Retrieval then returns a
fragment whose preparation method belongs to one medicine and whose dose belongs
to the next - worse than useless in a clinical tool, because it reads as
coherent. Splitting on the boundaries the text already has keeps each
formulation whole, and lets the chunk carry the verse number a practitioner
would cite.

What counts as a boundary, and what deliberately does not
---------------------------------------------------------
Entry openers split: verse numbers (``236.``, ``236-237.``, ``17:14``, ``K-01``,
Tamil numerals) and dosage-form headings (``... சூரணம்``, ``... பற்பம்``).

Section headers inside an entry do **not** split - ``செய்முறை`` (method),
``அளவு`` (dose), ``அனுபானம்`` (vehicle), ``பத்தியம்`` (regimen). Splitting there
was tempting and would be wrong: it strands a dose in a chunk that never names
the medicine it belongs to, so "what is the dose of Thalagam?" retrieves a
passage reading "அளவு: 100 மி.கி." with nothing to attach it to. They are
matched anyway, but only as evidence that a formulation entry is present.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Iterable, Sequence

from app import textnorm

# U+0BE6..U+0BF2 - Tamil zero through one-thousand.
_TAMIL_DIGITS = "௦-௲"

# Dosage forms. A short line ending in one of these is a formulation heading;
# mid-sentence occurrences are ignored because the line-length guard rejects them.
FORM_WORDS: tuple[str, ...] = (
    "சூரணம்", "செந்தூரம்", "பற்பம்", "பஸ்பம்", "இளகம்", "லேகியம்", "மெழுகு",
    "கற்பம்", "குளிகை", "மாத்திரை", "தைலம்", "நெய்", "இரசாயனம்", "குடிநீர்",
    "சுண்ணம்", "கஷாயம்", "வடகம்", "பொடி", "கியாழம்", "தூதுவளை", "பர்பம்",
)

# Present inside an entry, never used to split. See the module docstring.
#
# Also the evidence that a numbered chunk is a real entry rather than a contents
# line - see looks_like_entry. The singular "தீரும் நோய்" is listed rather than
# the plural so it matches both; document 2 uses the singular on some pages and
# the plural on others. "துணை மருந்து" is the adjuvant heading that book uses in
# place of "அனுபானம்".
SECTION_WORDS: tuple[str, ...] = (
    "செய்முறை", "அளவு", "அனுபானம்", "பத்தியம்", "குணம்", "தீரும் நோய்",
    "சேர்க்கும் பொருட்கள்", "மருந்தாக்கல்", "துணை மருந்து", "மருந்தாகும்",
)

# Speckle between the left margin and the marker. Scanned headings pick up stray
# ink that Tesseract renders as a character, and anchoring hard at ^[ \t]* threw
# away the whole heading when it did: 18 of 69 chapter:verse headings in
# document 1 were missed this way, every one of them for a leading artefact.
#
#     _ 17:2 ஆமை ஓடு பற்பம்        ச 16:4 அயவீரச் செந்தூரம்
#     ககக 13:9 மகாவீர மெழுகு       £ 21:2 வெள்வங்கச் சுண்ணம்
#
# Two constraints keep this from becoming a licence to match mid-sentence
# numbers. The pattern stays anchored to the start of a line, so noise is only
# tolerated where a heading would begin - never in running prose. And a noise
# token may not be a digit: allowing one would let "2 17:25" read as verse 2,
# and would reopen the decimal-quantity confusion the lookahead below closes.
#
# Deliberately not exhaustive. Noise carrying its own digit ("' ட 2") is still
# missed; covering it would mean guessing which number is the marker.
#
# The lookahead excludes Tamil digits as well as ASCII ones. Python's [0-9] is
# ASCII-only while \w accepts ௨௩௬, so without them a Tamil-numeral marker had
# its own leading digits eaten as noise and ௨௩௬ parsed as verse ௬.
_MARKER_NOISE = (
    r"(?:[^\w\s]{1,3}|(?![0-9" + _TAMIL_DIGITS + r"])\w{1,3})[ \t]*"
)

_ENTRY_NUMBER = re.compile(
    r"""
    ^[ \t]*
    (?:""" + _MARKER_NOISE + r"""){0,2}
    (?:
        \(\s*(?P<paren>[0-9]{1,4}(?:\s*[-–]\s*[0-9]{1,4})?)\s*\)   # (236) (236-237)
      | (?P<plain>[0-9]{1,4}(?:\s*[-–]\s*[0-9]{1,4})?)\s*[.):\]]   # 236.  236-237)
      | (?P<chapter>[0-9]{1,3}\s*:\s*[0-9]{1,3})                        # 17:14
      | (?P<coded>[A-Z]{1,4}\s*[-–]\s*[0-9]{1,3})                  # K-01  SFI-12
      | (?P<tamil>[""" + _TAMIL_DIGITS + r"""]{1,4})\s*[.)\]]?          # ௨௩௬.
    )
    # Whitespace after the marker is OPTIONAL. Real books set entry headings
    # tight against the number - document 2 prints "1.மயிலிறகாதிச் தூரணம்" with
    # no space, and requiring one missed every preparation title in the book
    # while still matching the ingredient lines beneath them, which do have one.
    #
    # The lookahead must reject a digit, or a decimal quantity at the start of a
    # line ("2.5 g") would parse as verse 2. Newlines still count as whitespace:
    # scans frequently break the line right after the marker.
    \s*(?=[^\s\d])
    """,
    re.VERBOSE | re.MULTILINE,
)

_FORM_HEADING = re.compile(
    r"^[ \t]*(?P<title>[^\n]{0,80}?(?:" + "|".join(FORM_WORDS) + r"))[ \t]*[:.]?[ \t]*$",
    re.MULTILINE,
)

_SECTION_HEADING = re.compile("|".join(SECTION_WORDS))

# Units and quantity words that mark a line as an ingredient measurement.
_QUANTITY_WORDS = (
    "பங்கு", "கிராம்", "மில்லி", "மி.கி", "மில்லிகிராம்", "பலம்", "வீசை",
    "கழஞ்சு", "வராகன்", "தேவையான அளவு", "சம அளவு", "சம எடை",
    "g", "mg", "ml", "kg",
)

# One item of a numbered ingredient list, not the heading of an entry:
#
#     3. மயிலிறகு சாம்பல் - 4% பங்கு
#     7. மணமுள்ள சடாமாஞ்சில் - 116 வீசை (87.5 கிராம்)
#     12. தாய்ப்பால் - தேவையான அளவு
#
# The discriminator is a dash followed by a quantity. A preparation's own
# heading names the medicine and carries no measurement - the quantities belong
# to the ingredients listed beneath it.
# The same speckle tolerance as _ENTRY_NUMBER, and for the same reason in
# reverse: once a leading artefact stopped hiding the marker, it started hiding
# the *suppression* instead. ", 3. மயிலிறகு சாம்பல் - 4% பங்கு" is an ingredient
# line whichever glyph the scanner put in front of it, and without this it came
# back as a boundary and fragmented the formulation it belongs to.
_QUANTITY_ITEM = re.compile(
    r"^[ \t]*(?:" + _MARKER_NOISE + r"){0,2}"
    r"[0-9]{1,3}[.)]\s+\S[^\n]*?[-–—][ \t]*(?:"
    r"[0-9]|" + "|".join(re.escape(w) for w in _QUANTITY_WORDS) + r")",
    re.MULTILINE,
)


def is_ingredient_line(line: str) -> bool:
    """True when a numbered line measures an ingredient rather than opening an entry.

    Splitting here is what fragmented real formulations on document 2: the
    chunker cut at ingredient 3 of a list, stranding ingredients 1-2 in one
    chunk and the preparation method in another, then labelled the second
    ``verse_no = 3``. A practitioner would see a citation to "verse 3" of a book
    that has no verse 3, attached to a method whose medicine is named in a
    different chunk.
    """
    return bool(_QUANTITY_ITEM.match(line)) or bool(_QUANTITY_ITEM.search(line.split("\n")[0]))


# English section headers, for the English-language books in the corpus. Without
# these, looks_like_entry would strip the citation from every entry in Parks and
# the TVA volume, which carry exactly the same structure in another language.
_ENGLISH_SECTION = re.compile(
    r"\b(?:ingredients?|preparation|method|dose|dosage|anupanam|adjuvant|"
    r"indications?|contra-?indications?|shelf\s*life|regimen|pathiyam)\b\s*[:\-]",
    re.IGNORECASE,
)


def looks_like_entry(text: str) -> bool:
    """True when a segment has the shape of a formulation entry.

    A real entry carries at least one section header - ``செய்முறை`` (method),
    ``அளவு`` (dose), ``தீரும் நோய்`` (indications), or their English
    equivalents. A contents page carries a number and a run of bare names, which
    is how page 4 of document 2 produced ``verse 61`` from what is actually a
    page number in a table of contents.
    """
    text = text or ""
    return bool(_SECTION_HEADING.search(text)) or bool(_ENGLISH_SECTION.search(text))


# A source citation printed with an entry heading. Every spelling below is taken
# from document 2, which is inconsistent about spacing, separators, abbreviation
# and parenthesisation:
#
#     (சித்த வைத்தியத் திரட்டு, பக்கம் எண் :223)
#     (சித்த வைத்தியதிரட்டு பக்கஎண்.154-156)
#     (குணபாடம், பாகம் 2 மற்றும்3, ப.எண்.132)
#     (அகஸ்தியர் பரிபூரணம் 400, பாடல் 261-284)
#     சித்த வைத்தியத்திரட்டு, பக்கம் எண்: 42
#
# The trailing digit requirement is what makes this a citation rather than a
# passing mention of a page: a source reference always resolves to a number.
# Document 1 adds two forms document 2 never used - a verse reference spelled
# ``செய்யுள் எண்``, and a publication year inside the parentheses:
#
#     (சித்த வைத்தியத் திரட்டு, 1987, பக்கம் எண்- 269, செய்யுள் எண் 435)
#     (தேரையர் தைலவருக்கச் சுருக்கம், 1970, பக்கம் எண் 137-139, செய்யுள் என் 130. 133)
#
# ``எண்`` is accepted as ``என்`` too: the second line above is what the scanner
# actually produced, and the two differ by one dot. The variant is only allowed
# directly after a citation head word, so the very common ordinary word ``என்``
# cannot pull an unrelated number in on its own.
_CITATION = re.compile(
    r"(?:பக்கம்|பக்க|ப\s*\.|பாடல்|செய்யுள்|\b(?:pages?|pp?\.|verses?|song)\b)"
    r"\s*[.,]?\s*(?:(?:எ[ணன]்|nos?|number)\s*[.:]?\s*)?"
    r"[.:,\-–—]?\s*\(?\s*[0-9" + _TAMIL_DIGITS + r"]",
    re.IGNORECASE,
)

# A citation sits on the heading line or just under it, never past the first
# ingredient. Looking deeper would find the NEXT entry's citation and vouch for
# a heading that has none.
_CITATION_WINDOW_LINES = 3
_CITATION_WINDOW_CHARS = 300


def has_citation(text: str) -> bool:
    """True when a segment opens with a heading carrying a source citation.

    This is the discriminator between a real entry heading and a numbered
    ingredient or note line. Corroborating a bare number against the page as a
    whole - the previous rule - was too weak: a continuation page is mid-recipe,
    so it contains ``செய்முறை`` and reads like an entry no matter what its first
    numbered line actually is. Auditing document 2 against the book's own 1..70
    ordering found 13 ingredient and note lines cited as verses that way.

    A heading with no printed source now goes unlabelled. That is the intended
    trade: a missing verse_no is honest, a wrong one sends a practitioner to a
    verse that does not exist.
    """
    lines = [line for line in (text or "").splitlines() if line.strip()]
    opening = "\n".join(lines[:_CITATION_WINDOW_LINES])[:_CITATION_WINDOW_CHARS]
    return bool(_CITATION.search(opening))


def ambiguous_number_offsets(text: str) -> set[int]:
    """Offsets whose marker is a bare number, and so needs corroboration.

    ``17:14`` and ``K-01`` are citation forms - nobody numbers the pages of a
    contents list that way, so they are trusted on sight. A bare ``61.`` is
    genuinely ambiguous: it opens an entry in a formulary and marks a page in a
    table of contents, and only the surrounding text tells them apart.
    Restricting the entry-evidence requirement to those forms keeps chapter-and-
    verse citations intact on prose that has no formulation structure at all.

    Tamil numerals used to be trusted here on the theory that nothing numbers a
    contents page in ``௨௩௬``. Document 1 does exactly that: ``௩`` on page 5 and
    ``௪`` on page 8 are printed page numbers, and both were being served as
    verse citations. A Tamil numeral is therefore the same kind of bare number
    as an Arabic one and gets the same treatment - it keeps its label when a
    citation stands next to it, and goes unlabelled otherwise.
    """
    offsets: set[int] = set()
    for match in _ENTRY_NUMBER.finditer(text):
        if match.lastgroup in ("plain", "paren", "tamil"):
            offsets.add(match.start())
    return offsets

# Runs of dots/underscores from a table of contents, and OCR speckle lines.
_TOC_LEADER = re.compile(r"[.…_]{4,}")
_WHITESPACE = re.compile(r"[ \t ]+")
_BLANK_LINES = re.compile(r"\n{3,}")


@dataclass(frozen=True)
class Segment:
    """A structurally coherent span of one page."""

    text: str
    verse_no: str | None
    # False when the segment came from the sliding-window fallback rather than a
    # detected boundary. The pipeline logs the ratio; a document that is 100%
    # fallback usually means the OCR lost the line structure.
    structural: bool = True


def normalise_verse(raw: str) -> str:
    """Collapse a matched marker to the form stored in ``doc_chunks.verse_no``.

    Whitespace inside a marker is an OCR artefact (``236 - 237``, ``17 : 14``),
    and the en-dash is normalised to a hyphen so the seed data's ``236-237``
    and a scan's ``236–237`` are the same citation rather than two.
    """
    cleaned = _WHITESPACE.sub("", raw).replace("–", "-")
    return cleaned.strip(".):]·")


def clean_page_text(text: str) -> str:
    """Tidy OCR output without discarding content.

    Unicode normalisation is delegated to :func:`app.textnorm.normalise` so the
    query side applies exactly the same transformation. It does two things that
    matter for Tamil: NFC composition, because OCR emits vowel signs decomposed
    inconsistently and the same word can carry two byte sequences; and stripping
    zero-width characters, because Tesseract appends U+200C after Tamil
    word-final consonants while a PDF text layer does not. Both forms look
    identical on screen and compare unequal, so the same word indexed from the
    two sources would not match.
    """
    if not text:
        return ""
    text = textnorm.normalise(text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _TOC_LEADER.sub(" ", text)
    text = "\n".join(_WHITESPACE.sub(" ", line).strip() for line in text.split("\n"))
    return _BLANK_LINES.sub("\n\n", text).strip()


def estimate_tokens(text: str) -> int:
    """Rough token count for the ``token_count`` column.

    Whitespace words undercount Tamil badly - it is agglutinative, so one
    orthographic word is frequently several subword tokens. The 1.6 factor is a
    correction, not a measurement. The pipeline passes the model's real
    tokeniser when one is loaded; this is the fallback that keeps the chunker
    free of a torch import.
    """
    words = len(text.split())
    return int(words * 1.6) + 1 if words else 0


def find_boundaries(text: str) -> list[tuple[int, str | None]]:
    """Locate entry openers as ``(offset, verse_no)``, ordered and de-duplicated."""
    found: dict[int, str | None] = {}

    for match in _ENTRY_NUMBER.finditer(text):
        # An ingredient measurement is not an entry opener. Skipping it here
        # rather than only dropping its label keeps the ingredient list attached
        # to the method it belongs to, instead of cutting the formulation in two.
        line_end = text.find("\n", match.start())
        line = text[match.start(): line_end if line_end != -1 else len(text)]
        if is_ingredient_line(line):
            continue
        raw = next(g for g in match.groups() if g is not None)
        found[match.start()] = normalise_verse(raw)

    for match in _FORM_HEADING.finditer(text):
        title = match.group("title").strip()
        # A bare form word ("சூரணம்") on its own line is a column header in a
        # table, not the name of a medicine. Require something in front of it.
        if title in FORM_WORDS:
            continue
        found.setdefault(match.start(), None)

    return sorted(found.items())


def split_structural(text: str, min_chars: int) -> list[Segment]:
    """Split on entry boundaries. Returns ``[]`` when the page has no structure.

    A single boundary is not structure - it is usually a page number caught by
    the numeric pattern. Two or more is evidence of a numbered list of entries,
    so that is where the fallback line sits.
    """
    boundaries = find_boundaries(text)
    ambiguous = ambiguous_number_offsets(text)

    # Two or more markers is evidence of a numbered list of entries. One marker
    # used to be rejected outright, on the grounds that a lone number is usually
    # a page number - but that predates having corroboration. A page holding one
    # complete formulation is now common: suppressing its ingredient lines
    # leaves exactly one boundary, and rejecting it would drop the entry onto
    # the sliding window and lose the citation the heading carries.
    #
    # A single marker is therefore accepted when the page also reads like an
    # entry, or when the marker is an unambiguous citation form. A bare number
    # on prose with no entry structure is still rejected.
    if not boundaries:
        return []
    if len(boundaries) < 2:
        only = boundaries[0][0]
        corroborated = looks_like_entry(text) or only not in ambiguous
        if not corroborated:
            return []
    segments: list[Segment] = []

    # Text before the first marker: a running header, or the tail of an entry
    # that began on the previous page. Keep it - dropping it would lose content
    # silently, which is the one thing this pipeline must never do - but it
    # carries no verse number of its own.
    preamble = text[: boundaries[0][0]].strip()
    if len(preamble) >= min_chars:
        segments.append(Segment(text=preamble, verse_no=None))

    for i, (start, verse) in enumerate(boundaries):
        end = boundaries[i + 1][0] if i + 1 < len(boundaries) else len(text)
        body = text[start:end].strip()
        if body:
            # A bare number is kept as a citation only when the heading it opens
            # is followed by a printed source. Reading like an entry is not
            # enough: a continuation page is mid-recipe, so it carries செய்முறை
            # and vouches for whatever numbered line happens to come first -
            # which is how 13 ingredient and note lines became verses on
            # document 2. Unambiguous citation forms (17:14, K-01, ௨௩௬) are
            # trusted without corroboration.
            keep = verse
            if start in ambiguous and not has_citation(body):
                keep = None
            segments.append(Segment(text=body, verse_no=keep))

    return segments


def sliding_window(text: str, size: int, overlap: int) -> list[str]:
    """Character windows with overlap, cut at whitespace where possible.

    Overlap exists so a sentence split across two windows is still wholly
    present in one of them. Cuts snap back to the nearest space within a tenth
    of the window, because a mid-word cut corrupts the token at both edges.
    """
    if size <= 0:
        raise ValueError("chunk size must be positive")
    if overlap >= size:
        # Otherwise each window would start at or before the previous one and
        # the loop would never terminate.
        raise ValueError(f"chunk overlap ({overlap}) must be smaller than size ({size})")

    text = text.strip()
    if not text:
        return []
    if len(text) <= size:
        return [text]

    windows: list[str] = []
    start = 0
    snap_budget = max(1, size // 10)

    while start < len(text):
        end = min(start + size, len(text))
        if end < len(text):
            pivot = text.rfind(" ", end - snap_budget, end)
            if pivot > start:
                end = pivot
        window = text[start:end].strip()
        if window:
            windows.append(window)
        if end >= len(text):
            break
        # Both edges need snapping, not just the end. `end - overlap` is a raw
        # character offset and lands mid-word roughly as often as not, which
        # would open every window after the first on a word fragment.
        next_start = end - overlap
        pivot = text.rfind(" ", start, next_start)
        if pivot != -1:
            next_start = pivot + 1
        # max() guarantees forward progress even when a snap pulls the offset
        # back near `start`; without it a pathological page could spin forever.
        start = max(next_start, start + 1)

    return windows


def chunk_page(
    text: str,
    *,
    chunk_size: int = 900,
    chunk_overlap: int = 150,
    min_chars: int = 60,
) -> list[Segment]:
    """One page to segments: structural where possible, windowed where not."""
    text = clean_page_text(text)
    if not text:
        return []

    segments = split_structural(text, min_chars)
    if not segments:
        segments = [Segment(text=text, verse_no=None, structural=False)]

    out: list[Segment] = []
    for segment in segments:
        if len(segment.text) <= chunk_size:
            out.append(segment)
            continue
        # An entry longer than the window still splits, but every piece keeps the
        # verse number so a citation survives the split.
        for window in sliding_window(segment.text, chunk_size, chunk_overlap):
            out.append(
                Segment(text=window, verse_no=segment.verse_no, structural=segment.structural)
            )

    return [s for s in out if len(s.text) >= min_chars]


def chunk_document(
    pages: Iterable[tuple[int, str]],
    *,
    source_document_id: int,
    book_name: str | None = None,
    chunk_size: int = 900,
    chunk_overlap: int = 150,
    min_chars: int = 60,
    token_counter: Callable[[str], int] | None = None,
) -> list[dict]:
    """Chunk every page of a document into rows ready for ``doc_chunks``.

    ``chunk_index`` runs across the whole document, not per page. It has to:
    ``doc_chunks`` carries ``UNIQUE (source_document_id, chunk_index)``, so a
    per-page counter would collide on the second page and abort the insert.

    :param pages: ``(page_no, text)`` pairs, in reading order.
    :param token_counter: the model's tokeniser when available; falls back to
        :func:`estimate_tokens`.
    """
    count_tokens = token_counter or estimate_tokens
    rows: list[dict] = []
    index = 0

    for page_no, page_text in pages:
        for segment in chunk_page(
            page_text,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            min_chars=min_chars,
        ):
            rows.append(
                {
                    "source_document_id": source_document_id,
                    "book_name": book_name,
                    "page_no": page_no,
                    "verse_no": segment.verse_no,
                    "chunk_index": index,
                    "content": segment.text,
                    "token_count": count_tokens(segment.text),
                    "structural": segment.structural,
                }
            )
            index += 1

    return rows


def structural_ratio(rows: Sequence[dict]) -> float:
    """Share of chunks that came from a detected boundary, for logging.

    A ratio near zero means the OCR flattened the line structure the detector
    depends on, so retrieval will be citing page numbers instead of verses. It
    is a quality signal worth surfacing, not an error.
    """
    if not rows:
        return 0.0
    return sum(1 for r in rows if r.get("structural")) / len(rows)


def has_formulation_markers(text: str) -> bool:
    """True when a page looks like formulary content rather than front matter.

    Used only for logging and test assertions - nothing is dropped on the
    strength of it.
    """
    return bool(_SECTION_HEADING.search(text)) or any(w in text for w in FORM_WORDS)
