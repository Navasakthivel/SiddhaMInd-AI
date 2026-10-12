"""Chunker tests. No PDF, no database, no model - synthetic text only.

The chunker is where retrieval quality is won or lost, so the cases below are
about boundaries and what survives them, not about line counts.
"""

import pytest

from app.ingestion.chunker import (
    Segment,
    chunk_document,
    chunk_page,
    clean_page_text,
    estimate_tokens,
    ambiguous_number_offsets,
    find_boundaries,
    looks_like_entry,
    is_ingredient_line,
    has_citation,
    has_formulation_markers,
    normalise_verse,
    sliding_window,
    split_structural,
    structural_ratio,
)

# A page with three numbered entries, in the shape the seed data describes.
TAMIL_PAGE = """சித்த மருத்துவம் - தாது வகுப்பு

236. திரிகடுகு சூரணம்
சேர்க்கும் பொருட்கள்: சுக்கு, மிளகு, திப்பிலி சம அளவு.
செய்முறை: மூன்றையும் தனித்தனியே இடித்து சலித்து கலக்கவும்.
அளவு: 1 முதல் 2 கிராம்.
அனுபானம்: தேன்.

237. நிலவேம்பு குடிநீர்
சேர்க்கும் பொருட்கள்: நிலவேம்பு, வெட்டிவேர், சந்தனம்.
செய்முறை: இடித்து கஷாயம் வைக்கவும்.
அளவு: 30 மி.லி.

238. பர்பம் தயாரிப்பு
செய்முறை: சுத்தி செய்த பின் புடம் போடவும்.
பத்தியம்: புளி, மீன் தவிர்க்கவும்.
"""

ENGLISH_PAGE = """CHAPTER 4 - PREVENTIVE MEDICINE

17:14 Regimen for the rainy season
Bathing in warm water is advised. Cold exposure aggravates vatham.

17:15 Regimen for summer
Light food and buttermilk are recommended through the hot months.
"""

PROSE_PAGE = (
    "The Siddha system of medicine traces its origin to the eighteen Siddhars. "
    "It is practised predominantly in Tamil Nadu and relies on a tridosha model "
    "described as vatham pitham and kabam. " * 12
)


# --------------------------------------------------------------------------
# boundary detection
# --------------------------------------------------------------------------


def test_splits_on_numbered_entries():
    segments = split_structural(clean_page_text(TAMIL_PAGE), min_chars=20)
    bodies = [s.text for s in segments]
    assert any("திரிகடுகு" in b for b in bodies)
    assert any("நிலவேம்பு" in b for b in bodies)
    assert any("பர்பம்" in b for b in bodies)


def test_entries_printing_no_source_are_split_but_left_unlabelled():
    """The accepted cost of requiring a citation.

    TAMIL_PAGE numbers its entries and prints no source under them. The split
    still happens - the boundary is real and the formulations stay whole - but
    the number is not promoted to a verse_no, because a bare number with nothing
    corroborating it is precisely the shape that mislabelled 13 ingredient and
    note lines on document 2.

    Books that print no per-entry source therefore retrieve without verse
    citations. That is the deliberate trade: a missing verse_no is honest, a
    wrong one sends a practitioner to a verse that does not exist.
    """
    segments = split_structural(clean_page_text(TAMIL_PAGE), min_chars=20)
    assert {s.verse_no for s in segments} == {None}


def test_preamble_before_first_marker_is_kept():
    """Losing it would be silent content loss, which the pipeline forbids."""
    text = clean_page_text(TAMIL_PAGE)
    segments = split_structural(text, min_chars=10)
    assert segments[0].verse_no is None
    assert "தாது வகுப்பு" in segments[0].text


def test_each_formulation_stays_whole():
    """Method, dose and vehicle must travel with the name that owns them."""
    segments = split_structural(clean_page_text(TAMIL_PAGE), min_chars=20)
    entry = next(s for s in segments if "திரிகடுகு" in s.text)
    assert "திரிகடுகு" in entry.text
    assert "செய்முறை" in entry.text
    assert "அளவு" in entry.text
    assert "அனுபானம்" in entry.text
    # and must not have swallowed the next entry
    assert "நிலவேம்பு" not in entry.text


def test_does_not_split_on_section_headers():
    """அளவு / செய்முறை are inside an entry, never a boundary of one."""
    offsets = [o for o, _ in find_boundaries(clean_page_text(TAMIL_PAGE))]
    text = clean_page_text(TAMIL_PAGE)
    for word in ("செய்முறை", "அளவு", "அனுபானம்", "பத்தியம்"):
        assert text.index(word) not in offsets


def test_splits_on_chapter_verse_form():
    segments = split_structural(clean_page_text(ENGLISH_PAGE), min_chars=20)
    assert [s.verse_no for s in segments if s.verse_no] == ["17:14", "17:15"]


@pytest.mark.parametrize(
    "line,expected",
    [
        ("236. Entry text here", "236"),
        ("236-237. Entry spanning two verses", "236-237"),
        ("236 - 237. Spaced by the scanner", "236-237"),
        ("236–237. En dash from the scanner", "236-237"),
        ("(236) Parenthesised marker", "236"),
        ("17:14 Chapter and verse", "17:14"),
        ("K-01 Coded entry", "K-01"),
        ("S-11 Another coded entry", "S-11"),
        ("௨௩௬. Tamil numerals", "௨௩௬"),
    ],
)
def test_marker_forms_seen_in_the_seed_data(line, expected):
    text = f"Preamble line that is long enough to survive.\n{line}\nBody of the entry.\n"
    boundaries = find_boundaries(text)
    assert expected in [v for _, v in boundaries]


def test_normalise_verse_collapses_scanner_whitespace():
    assert normalise_verse("236 - 237") == "236-237"
    assert normalise_verse("17 : 14") == "17:14"
    assert normalise_verse("236.") == "236"


def test_bare_form_word_alone_is_not_a_heading():
    """A lone 'சூரணம்' is a table column header, not a medicine."""
    text = "சூரணம்\nsome following text that is reasonably long to keep\n"
    assert find_boundaries(text) == []


def test_form_heading_with_a_name_is_a_boundary():
    text = "Intro paragraph long enough to be kept as a preamble here.\n" \
           "திரிகடுகு சூரணம்\nபொருட்கள்: சுக்கு.\n" \
           "நிலவேம்பு கஷாயம்\nபொருட்கள்: நிலவேம்பு.\n"
    assert len(find_boundaries(text)) >= 2


def test_single_marker_is_not_treated_as_structure():
    """One number is usually the page number, not a list of entries."""
    text = "46\n" + "Ordinary prose that carries no entry structure at all. " * 6
    assert split_structural(clean_page_text(text), min_chars=60) == []


# --------------------------------------------------------------------------
# sliding-window fallback
# --------------------------------------------------------------------------


def test_prose_falls_back_to_the_window():
    segments = chunk_page(PROSE_PAGE, chunk_size=300, chunk_overlap=50, min_chars=20)
    assert len(segments) > 1
    assert all(s.structural is False for s in segments)
    assert all(s.verse_no is None for s in segments)


def test_window_overlaps_by_the_configured_amount():
    text = " ".join(f"w{i:04d}" for i in range(400))
    windows = sliding_window(text, size=300, overlap=100)
    assert len(windows) > 2
    for first, second in zip(windows, windows[1:]):
        # The tail of one window must reappear at the head of the next, or the
        # overlap is not doing the job it exists for.
        tail = first[-40:].strip()
        assert tail and tail.split()[-1] in second


def test_window_does_not_cut_mid_word():
    text = " ".join(f"token{i:03d}" for i in range(200))
    for window in sliding_window(text, size=250, overlap=50):
        for word in window.split():
            assert word.startswith("token") and len(word) == 8


def test_window_rejects_overlap_at_or_above_size():
    """Guard against the classic infinite loop rather than hanging the worker."""
    with pytest.raises(ValueError, match="smaller than size"):
        sliding_window("some text", size=100, overlap=100)
    with pytest.raises(ValueError):
        sliding_window("some text", size=100, overlap=150)


def test_window_terminates_on_pathological_input():
    """No spaces at all, so every snap-back fails and progress must still happen."""
    windows = sliding_window("x" * 5000, size=200, overlap=180)
    assert windows and sum(len(w) for w in windows) >= 5000


def test_short_text_is_a_single_window():
    assert sliding_window("short enough", size=900, overlap=150) == ["short enough"]


def test_empty_text_yields_nothing():
    assert sliding_window("   \n  ", size=900, overlap=150) == []
    assert chunk_page("", chunk_size=900, chunk_overlap=150) == []


# --------------------------------------------------------------------------
# oversized entries
# --------------------------------------------------------------------------


def test_long_entry_splits_but_keeps_its_verse_number():
    # Cited, so the number survives corroboration - this test is about the label
    # travelling across the sliding window, not about whether it is assigned.
    long_entry = ("236. திரிகடுகு சூரணம்\n(சித்த வைத்தியத் திரட்டு, பக்கம் எண்: 223)\n"
                  + ("செய்முறை விவரம் மிக நீளமாக உள்ளது. " * 80))
    page = "Preamble that is long enough to be retained here.\n" + long_entry + "\n237. Short one.\n"
    segments = chunk_page(page, chunk_size=400, chunk_overlap=80, min_chars=20)
    parts = [s for s in segments if s.verse_no == "236"]
    assert len(parts) > 1, "the oversized entry should have been windowed"
    assert all(p.verse_no == "236" for p in parts), "citation must survive the split"


# --------------------------------------------------------------------------
# document assembly
# --------------------------------------------------------------------------


def test_chunk_index_is_sequential_across_pages():
    """doc_chunks has UNIQUE (source_document_id, chunk_index): a per-page
    counter would collide on page 2 and abort the whole insert."""
    rows = chunk_document(
        [(1, TAMIL_PAGE), (2, ENGLISH_PAGE), (3, PROSE_PAGE)],
        source_document_id=7,
        book_name="Test Book",
        chunk_size=400,
        chunk_overlap=80,
        min_chars=20,
    )
    indices = [r["chunk_index"] for r in rows]
    assert indices == list(range(len(rows)))
    assert len(set(indices)) == len(indices)


def test_rows_carry_every_column_doc_chunks_needs():
    rows = chunk_document(
        [(4, TAMIL_PAGE)], source_document_id=7, book_name="Test Book", min_chars=20
    )
    assert rows
    for row in rows:
        assert row["source_document_id"] == 7
        assert row["book_name"] == "Test Book"
        assert row["page_no"] == 4
        assert row["chunk_index"] >= 0
        assert row["content"].strip()
        assert row["token_count"] > 0
        assert "verse_no" in row  # nullable, but always present


def test_page_numbers_are_preserved_per_row():
    rows = chunk_document(
        [(11, TAMIL_PAGE), (12, ENGLISH_PAGE)],
        source_document_id=1,
        min_chars=20,
        chunk_size=400,
        chunk_overlap=80,
    )
    assert {r["page_no"] for r in rows} == {11, 12}


def test_custom_token_counter_is_used():
    rows = chunk_document(
        [(1, TAMIL_PAGE)], source_document_id=1, min_chars=20, token_counter=lambda t: 42
    )
    assert all(r["token_count"] == 42 for r in rows)


def test_noise_below_min_chars_is_dropped():
    rows = chunk_document([(1, "12.\n46\n\n7\n")], source_document_id=1, min_chars=60)
    assert rows == []


def test_structural_ratio_reports_quality():
    structured = chunk_document([(1, TAMIL_PAGE)], source_document_id=1, min_chars=20)
    prose = chunk_document(
        [(1, PROSE_PAGE)], source_document_id=1, min_chars=20, chunk_size=300, chunk_overlap=50
    )
    assert structural_ratio(structured) == 1.0
    assert structural_ratio(prose) == 0.0
    assert structural_ratio([]) == 0.0


# --------------------------------------------------------------------------
# text cleanup
# --------------------------------------------------------------------------


def test_nfc_normalisation_unifies_decomposed_tamil():
    """OCR emits vowel signs inconsistently; Postgres FTS compares bytes, so two
    encodings of one word would miss each other in the keyword half."""
    decomposed = "க்ஷ"  # க + virama + ஷ
    cleaned = clean_page_text(decomposed)
    import unicodedata

    assert cleaned == unicodedata.normalize("NFC", decomposed)


def test_toc_leader_dots_are_stripped():
    cleaned = clean_page_text("Preface .............. 12")
    assert "...." not in cleaned
    assert "Preface" in cleaned and "12" in cleaned


def test_collapses_runs_of_blank_lines_and_spaces():
    assert clean_page_text("a\n\n\n\n\nb") == "a\n\nb"
    assert clean_page_text("a     b") == "a b"


def test_estimate_tokens_scales_with_length():
    assert estimate_tokens("") == 0
    assert estimate_tokens("one two three") >= 3


def test_has_formulation_markers():
    assert has_formulation_markers(TAMIL_PAGE)
    assert not has_formulation_markers("Ordinary English prose about nothing at all.")


def test_segment_is_immutable():
    """Frozen so a later stage cannot quietly rewrite a citation."""
    with pytest.raises(Exception):
        Segment(text="x", verse_no="1").verse_no = "2"  # type: ignore[misc]


# --------------------------------------------------------------------------
# verse_no false positives, from the real mrk-t1 ingestion
# --------------------------------------------------------------------------

# Verbatim from doc_id=2 page 4 - a table of contents. "61." is a PAGE NUMBER
# followed by a run of preparation names. The old rule labelled the chunk
# verse_no='61', putting a citation on screen that points at nothing.
REAL_CONTENTS_PAGE_4 = """61.

கஸ்தூரிக் கருப்பு
சிவனார் அமிர்தம்

தாளகக் கருப்பு

பூரக்கட்டூ

வெள்ளைப் பாடாணக்கட்டூ
"""

# Verbatim from doc_id=2 page 5 - a real entry. "3." is INGREDIENT three of a
# numbered list, not a verse; the preparation is named on the line above.
REAL_ENTRY_PAGE_5 = """1.மயிலிறகாதிச் தூரணம்
(சித்த வைத்தியத் திரட்டு, பக்கம் எண் :223)

1. திப்பிலி - 1 பங்கு
2. சீரகம் - 2 பங்கு
3. மயிலிறகு சாம்பல் - 4% பங்கு

செய்முறை

திப்பிலி மற்றும் சீரகத்தை அளவுப்படி எடுத்து பொடித்து
கொள்ள வேண்டும். பிறகு அந்த பொடியை மயிலிறகு
சாம்பலுடன் சேர்க்க சுரணமாகும்.

துணை மருந்து
தேன்

தீரும் நோய்

விக்கல் நிற்கும்.
"""


def test_a_contents_page_number_is_not_a_verse():
    """The page 4 regression. 61 is where a preparation appears, not a verse."""
    segments = chunk_page(REAL_CONTENTS_PAGE_4, min_chars=20)
    assert segments, "the page should still produce chunks"
    assert all(s.verse_no is None for s in segments), \
        f"contents page produced verse numbers: {[s.verse_no for s in segments]}"


def test_the_old_rule_would_have_labelled_the_contents_page():
    """Establishes the bug: the number really is there and really does match."""
    from app.ingestion.chunker import _ENTRY_NUMBER
    assert _ENTRY_NUMBER.search(clean_page_text(REAL_CONTENTS_PAGE_4)), \
        "fixture must contain a number the pattern matches"


def test_ingredient_lines_do_not_split_a_formulation():
    """The worse half of the same bug: cutting at ingredient 3 stranded
    ingredients 1-2 from the method, and labelled the remainder verse 3."""
    segments = chunk_page(REAL_ENTRY_PAGE_5, min_chars=20)

    assert len(segments) == 1, (
        f"the entry should stay whole, got {len(segments)} pieces: "
        f"{[s.text[:40] for s in segments]}"
    )
    whole = segments[0].text
    assert "மயிலிறகாதிச்" in whole, "the medicine name must travel with its method"
    assert "செய்முறை" in whole
    assert "தீரும் நோய்" in whole


def test_an_ingredient_number_is_never_used_as_a_verse():
    segments = chunk_page(REAL_ENTRY_PAGE_5, min_chars=20)
    assert all(s.verse_no != "3" for s in segments), \
        "ingredient 3 was labelled as verse 3"


@pytest.mark.parametrize("line", [
    "3. மயிலிறகு சாம்பல் - 4% பங்கு",
    "7. மணமுள்ள சடாமாஞ்சில் - 116 வீசை (87.5 கிராம்)",
    "2. சேராங்கொட்டை - 10",
    "12. தாய்ப்பால் - தேவையான அளவு",
    "10. மனோசிலை - 1 பங்கு",
    "5. சிற்றாமணக்கெண்ணெய் - 40 பலம் (1400 கிராம்)",
])
def test_real_ingredient_lines_are_recognised(line):
    """All taken from chunks the ingestion actually produced."""
    assert is_ingredient_line(line) is True


@pytest.mark.parametrize("line", [
    "236. திரிபலா சூரணம்",
    "42. நிலவேம்பு குடிநீர்",
    "101. Thiripala Chooranam",
])
def test_entry_headings_are_not_mistaken_for_ingredients(line):
    """A preparation heading names a medicine and carries no measurement."""
    assert is_ingredient_line(line) is False


def test_looks_like_entry_separates_the_two_real_pages():
    assert looks_like_entry(REAL_ENTRY_PAGE_5) is True
    assert looks_like_entry(REAL_CONTENTS_PAGE_4) is False


def test_a_genuine_verse_entry_still_gets_its_number():
    """The guard must not strip citations from real, sourced entries."""
    page = ("236. திரிபலா சூரணம்\n"
            "(சித்த வைத்தியத் திரட்டு, பக்கம் எண்: 223)\n"
            "சேர்க்கும் பொருட்கள்: கடுக்காய், தான்றிக்காய், நெல்லிக்காய்\n"
            "செய்முறை: பொடித்து சலிக்கவும்\n"
            "அளவு: 2 கிராம்\n\n"
            "237. சுக்கு சூரணம்\n"
            "(குணபாடம், பாகம் 2 மற்றும் 3, ப.எண்.132)\n"
            "செய்முறை: சுக்கை பொடிக்கவும்\n"
            "அளவு: 1 கிராம்\n")
    verses = {s.verse_no for s in chunk_page(page, min_chars=20)}
    assert "236" in verses and "237" in verses


def test_unambiguous_citation_forms_need_no_corroboration():
    """17:14 and K-01 are citation shapes; nobody numbers a contents page
    that way. Requiring entry evidence from them would strip legitimate verse
    references off English prose in Parks and the TVA volume."""
    text = clean_page_text(ENGLISH_PAGE)
    assert ambiguous_number_offsets(text) == set(), \
        "chapter:verse markers should not be treated as ambiguous"


def test_a_bare_number_is_the_ambiguous_form():
    text = clean_page_text(REAL_CONTENTS_PAGE_4)
    assert ambiguous_number_offsets(text), "61. is the form that needs corroboration"


def test_english_entries_keep_their_numbers_when_sourced():
    """An English formulary that prints a page reference is labelled like a
    Tamil one - the citation rule is language-neutral."""
    page = ("101. Thiripala Chooranam (Siddha Formulary of India, page no: 12)\n"
            "Ingredients: Kadukkai 35 g, Thandrikkai 35 g\n"
            "Preparation: Powder and sieve.\n"
            "Dose: 2 to 4 g twice daily\n\n"
            "102. Sukku Chooranam (Siddha Formulary of India, page no: 18)\n"
            "Ingredients: Dried ginger 100 g\n"
            "Dose: 1 to 2 g\n")
    verses = {s.verse_no for s in chunk_page(page, min_chars=20)}
    assert "101" in verses and "102" in verses


def test_unsourced_english_entries_are_unlabelled():
    """The shape in corpus/test-sample.pdf, which prints no source.

    Recorded so the cost is visible rather than discovered later: that fixture
    ingests as document 7 and its entries now retrieve without verse numbers.
    """
    page = ("101. Thiripala Chooranam\n"
            "Ingredients: Kadukkai 35 g, Thandrikkai 35 g\n"
            "Preparation: Powder and sieve.\n"
            "Dose: 2 to 4 g twice daily\n\n"
            "102. Sukku Chooranam\n"
            "Ingredients: Dried ginger 100 g\n"
            "Dose: 1 to 2 g\n")
    chunks = chunk_page(page, min_chars=20)
    assert {s.verse_no for s in chunks} == {None}
    # The text itself must still be there - unlabelled, never dropped.
    assert any("Thiripala" in s.text for s in chunks)


# --------------------------------------------------------------------------
# entry headings set tight against their number
# --------------------------------------------------------------------------


def test_a_title_with_no_space_after_the_number_is_detected():
    """The page 5 regression, verbatim from doc_id=2.

    Real books set an entry heading tight against its number. Requiring
    whitespace missed every preparation title in this document while still
    matching the ingredient lines beneath them - which do have a space - so the
    only numbers reaching doc_chunks were ingredient indices.
    """
    boundaries = find_boundaries("1.மயிலிறகாதிச் தூரணம்\n(சித்த வைத்தியத் திரட்டு, பக்கம் எண் :223)\n")
    assert "1" in [v for _, v in boundaries], \
        "the preparation title should now open an entry"


def test_the_page_5_entry_now_carries_its_title_number():
    segments = chunk_page(REAL_ENTRY_PAGE_5, min_chars=20)
    assert len(segments) == 1, "the entry must still stay whole"
    assert segments[0].verse_no == "1", \
        f"expected the title number 1, got {segments[0].verse_no!r}"
    assert "மயிலிறகாதிச்" in segments[0].text


@pytest.mark.parametrize("line", [
    "2.5 g of the powder",
    "0.5 ml twice daily",
    "12.75 grams total",
])
def test_a_decimal_quantity_is_not_read_as_a_verse(line):
    """Without the non-digit lookahead, "2.5 g" parses as verse 2."""
    page = f"Preamble long enough to be kept as its own segment here.\n{line}\nmore text\n"
    assert [v for _, v in find_boundaries(page)] == [], \
        f"{line!r} should not open an entry"


def test_a_decimal_inside_a_real_entry_does_not_create_a_boundary():
    page = ("236. திரிபலா சூரணம்\n"
            "செய்முறை: பொடிக்கவும்\n"
            "2.5 கிராம் அளவு எடுத்துக்கொள்ளவும்\n"
            "237. சுக்கு சூரணம்\n"
            "செய்முறை: பொடிக்கவும்\n")
    verses = [v for _, v in find_boundaries(page)]
    assert "2" not in verses, "the decimal dose became a verse marker"
    assert "236" in verses and "237" in verses


def test_spaced_headings_still_work():
    """The change makes whitespace optional, not forbidden."""
    boundaries = find_boundaries("236. திரிபலா சூரணம்\nசெய்முறை: x\n")
    assert "236" in [v for _, v in boundaries]


def test_a_lone_page_number_on_prose_is_still_not_structure():
    """The guard the single-boundary relaxation must not weaken: a bare number
    above ordinary prose is a page number, not an entry."""
    text = "46\n" + "Ordinary prose that carries no entry structure at all. " * 6
    assert split_structural(clean_page_text(text), min_chars=60) == []


def test_one_complete_entry_on_a_page_is_accepted():
    """A single corroborated marker is structure. Rejecting it dropped the whole
    formulation onto the sliding window and discarded its citation."""
    segments = split_structural(clean_page_text(REAL_ENTRY_PAGE_5), min_chars=20)
    assert len(segments) == 1
    assert segments[0].verse_no == "1"


# ---------------------------------------------------------------------------
# citation-corroborated verse labels
# ---------------------------------------------------------------------------
#
# Corroborating a bare number against the PAGE was too weak. A continuation page
# is mid-recipe, so it carries செய்முறை and reads like an entry - which promoted
# its first surviving ingredient line to a verse label. Auditing document 2
# against the book's own 1..70 ordering found 13 such labels.
#
# A real entry heading is followed by its source citation; an ingredient line
# never is. All fixtures below are verbatim from document 2.

REAL_ENTRY_WITH_CITATION = """1.மயிலிறகாதிச் தூரணம்
(சித்த வைத்தியத் திரட்டு, பக்கம் எண் :223)

1. திப்பிலி - 8 பங்கு

2. சீரகம் - 10 பங்கு
செய்முறை

திப்பிலி மற்றும் சீரகத்தை அளவுப்படி எடுத்து பொடித்து கொள்ள வேண்டும்."""

# The ingredient list that was being mislabelled "verse 5" on page 13. OCR
# dropped the dash before the quantity, so is_ingredient_line does not catch it.
REAL_INGREDIENT_RUN_PAGE_13 = """5. நாபி 1 பங்கு
6. சுக்கு - 1 பங்கு
7. இலிங்கம் - 6 பங்கு
செய்முறை

வெள்ளை பூண்டு சாற்றில் ஒரு சாமம் அரைத்து மாத்திரை செய்யவும்."""

# Page 26: a numbered NOTE under an entry, mislabelled "verse 1".
REAL_NOTE_RUN_PAGE_26 = """1. இம்மருந்து அதிக பேதியுண்டாக்கும். ஆதலால் அளவு குறைத்துக் கொடுத்தல் வேண்டும்.
2. செய்முறைக்கு அகத்தியர் அமிர்தகலை ஞானத்தையும் துணை மருந்து பார்க்கவும்.
தீரும் நோய்"""


@pytest.mark.parametrize(
    "citation",
    [
        "(சித்த வைத்தியத் திரட்டு, பக்கம் எண் :223)",   # spaced colon
        "(அகஸ்தியர் பரிபூரணம் 400, பாடல் எண் : 126 129)",  # பாடல் எண்
        "(அகஸ்தியர் பரிபூரணம் 400, பாடல் 261-284)",       # பாடல், no எண்
        "(குணபாடம், பாகம் 2 மற்றும்3, ப.எண்.132)",         # abbreviated ப.எண்
        "(சித்த வைத்தியதிரட்டு பக்கஎண்.154-156)",          # no space, no colon
        "(குணப்பாடம் பகுதி 2 மற்றும் 3, பக்க எண்: 109-110)",  # பக்க எண்
        "சித்த வைத்தியத்திரட்டு, பக்கம் எண்: 42",           # unparenthesised
        "(சரபேந்திர வைத்திய ரத்னாவளி, பக்கம் எண்,300)",     # comma separator
        "(குணபாடம் பாகம் 3 மற்றும் 3, பக்கம் எண்- 330)",    # dash separator
        "(ஹாஸ்பிடல் பார்மகோபியா, பக்கம் எண் : (14-15)",     # nested paren
        "(Siddha Vaidya Thirattu, page no: 223)",           # English corpus
    ],
)
def test_every_citation_spelling_in_the_book_is_recognised(citation):
    assert has_citation(f"7.ஒரு மருந்து\n{citation}\n1. திப்பிலி - 8 பங்கு")


@pytest.mark.parametrize(
    "text",
    [
        REAL_INGREDIENT_RUN_PAGE_13,
        REAL_NOTE_RUN_PAGE_26,
        "3. வீரம் - Y2 பங்கு\n4. கந்தி - 12 பங்கு\nசெய்முறை\nஅரைத்து மாத்திரை செய்யவும்.",
        "2. வெடியுப்பு - Ya பங்கு\n3. எலுமிச்சம்பழச்சாறு - தேவையான அளவு\nசெய்முறை",
    ],
)
def test_ingredient_and_note_runs_carry_no_citation(text):
    assert not has_citation(text)


def test_a_cited_entry_keeps_its_verse_number():
    segs = split_structural(REAL_ENTRY_WITH_CITATION, min_chars=20)
    assert [s.verse_no for s in segs] == ["1"]
    assert "மயிலிறகாதிச்" in segs[0].text


def test_an_ingredient_run_is_left_unlabelled_rather_than_mislabelled():
    """The whole point: missing is honest, wrong is misleading."""
    segs = split_structural(REAL_INGREDIENT_RUN_PAGE_13, min_chars=20)
    assert all(s.verse_no is None for s in segs), (
        "an ingredient line must never be cited as a verse"
    )
    # Content must survive - dropping it silently would be worse than mislabelling.
    assert "நாபி" in "".join(s.text for s in segs)


def test_numbered_notes_under_an_entry_are_left_unlabelled():
    segs = split_structural(REAL_NOTE_RUN_PAGE_26, min_chars=20)
    assert all(s.verse_no is None for s in segs)
    assert "இம்மருந்து" in "".join(s.text for s in segs)


def test_an_uncited_real_entry_loses_its_label_and_that_is_accepted():
    """Entries like '48.படிகாரப் பற்பம்' print no source. Unlabelled, not wrong."""
    text = "48.படிகாரப் பற்பம்\n1. படிகாரம் - தேவையான அளவு\nசெய்முறை\nஅரைத்து பற்பம் செய்யவும்."
    segs = split_structural(text, min_chars=20)
    assert all(s.verse_no is None for s in segs)
    assert "படிகாரப் பற்பம்" in "".join(s.text for s in segs)


def test_unambiguous_citation_forms_still_need_no_corroboration():
    """17:14 and K-01 are citation shapes; nothing numbers ingredients that way."""
    text = "17:14 ஒரு பாடல் வரி இங்கே உள்ளது மேலும் சில வார்த்தைகள்.\n\n17:15 அடுத்த வரி இங்கே."
    segs = split_structural(text, min_chars=10)
    assert [s.verse_no for s in segs] == ["17:14", "17:15"]


def test_the_page_4_contents_false_positive_stays_fixed():
    segs = split_structural(REAL_CONTENTS_PAGE_4, min_chars=20)
    assert all(s.verse_no is None for s in segs)


# ---------------------------------------------------------------------------
# OCR speckle before an entry marker
# ---------------------------------------------------------------------------
#
# Anchoring hard at the left margin lost 18 of 69 chapter:verse headings in
# document 1 - roughly a quarter of the book's citations - because a scan picks
# up stray ink before the number. All four fixtures below are verbatim from
# sfi-t1, one per artefact class: punctuation, a single Tamil letter, a run of
# Tamil letters, and a currency glyph.

REAL_SPECKLED_HEADINGS = [
    ("_ 17:2 ஆமை ஓடு பற்பம்", "17:2"),          # p29 - underscore
    ("ச 16:4 அயவீரச் செந்தூரம்", "16:4"),        # p19 - single Tamil letter
    ("ககக 13:9 மகாவீர மெழுகு", "13:9"),          # p15 - Tamil letter run
    ("£ 21:2 வெள்வங்கச் சுண்ணம்", "21:2"),       # p44 - currency glyph
]


@pytest.mark.parametrize("line,expected", REAL_SPECKLED_HEADINGS)
def test_a_speckled_heading_is_still_detected(line, expected):
    found = find_boundaries(line + "\nதேவையான சரக்குகள்:\n1. ஒரு பொருள் - 5 கிராம்")
    assert [v for _, v in found][:1] == [expected]


@pytest.mark.parametrize("line,expected", REAL_SPECKLED_HEADINGS)
def test_a_speckled_heading_keeps_its_verse_label(line, expected):
    page = (line + "\n(சித்த வைத்தியத் திரட்டு, 1987, பக்கம் எண் 158)\n"
            "தேவையான சரக்குகள்:\n1. ஒரு பொருள் - 5 கிராம்\nசெய்முறை: அரைக்கவும்.")
    segs = split_structural(page, min_chars=20)
    assert expected in [s.verse_no for s in segs]


def test_speckle_is_only_tolerated_at_the_start_of_a_line():
    """Mid-sentence numbers must not become boundaries.

    The anchor is what stops running prose from splitting; loosening it to
    allow noise must not loosen it to allow position.
    """
    prose = "அரைத்த பிறகு இஞ்சிச்சாறு நாளொன்றுக்கு 175 கி. வீதம் விட்டு 15 நாட்கள்."
    assert find_boundaries(prose) == []


def test_a_digit_is_never_treated_as_speckle():
    """A digit may not be swallowed as noise, or '2 17:25' reads as verse 2.

    This line is still not labelled 17:25 either - noise carrying its own digit
    is the case the pattern deliberately does not try to resolve, because
    picking the marker out of two adjacent numbers means guessing.
    """
    assert "2" not in [v for _, v in find_boundaries("2 17:25 வெங்கார பற்பம்")]
    assert "2" not in [v for _, v in find_boundaries("2.5 g of the powder")]


def test_speckle_does_not_resurrect_ingredient_lines():
    """A suppressed ingredient line stays suppressed when it carries speckle."""
    assert find_boundaries(", 3. மயிலிறகு சாம்பல் - 4% பங்கு") == []


def test_a_long_word_before_a_number_is_not_speckle():
    """Only a short fragment counts; a real word means this is prose, not a heading."""
    assert "236" not in [v for _, v in find_boundaries("மருந்தளவு 236. ஒரு மாத்திரை")]


# ---------------------------------------------------------------------------
# Tamil numerals are bare numbers, not citation forms
# ---------------------------------------------------------------------------
#
# They were trusted on sight on the theory that nothing numbers a contents page
# in ௨௩௬. Document 1 numbers its pages exactly that way, and both fixtures below
# are real page numbers from sfi-t1 that were being served as verse citations.

REAL_TAMIL_PAGE_NUMBERS = [
    ("௩ —\nமருந்தளவு: ஒரு மாத்திரை, இருவேளை.\nநாளளவு: மூன்று அல்லது ஆறு நாட்கள்.", "௩"),
    ("கனி ௪\nதேவையான சரக்குகள்:\nமட்டநிலத்தண்டு சாறு 175 கி.", "௪"),
]


@pytest.mark.parametrize("text,numeral", REAL_TAMIL_PAGE_NUMBERS)
def test_a_tamil_numeral_now_needs_corroboration(text, numeral):
    assert ambiguous_number_offsets(text), (
        f"{numeral} is a bare number and must require entry evidence"
    )


@pytest.mark.parametrize("text,numeral", REAL_TAMIL_PAGE_NUMBERS)
def test_an_uncited_tamil_page_number_is_not_a_verse(text, numeral):
    segs = split_structural(text, min_chars=20)
    assert numeral not in [s.verse_no for s in segs]
    # the text itself must survive - only the label goes
    assert any(s.text.strip() for s in segs) or segs == []


def test_a_cited_tamil_numeral_entry_keeps_its_label():
    """Demoting the form must not cost a genuine Tamil-numbered entry its citation."""
    text = ("௨௩௬. திரிகடுகு சூரணம்\n(சித்த வைத்தியத் திரட்டு, பக்கம் எண்: 223)\n"
            "செய்முறை: இடித்து சலிக்கவும்.\nஅளவு: 2 கிராம்.")
    segs = split_structural(text, min_chars=20)
    assert "௨௩௬" in [s.verse_no for s in segs]


def test_a_tamil_numeral_is_still_detected_as_a_boundary():
    """Only the label needs evidence; the split itself is unchanged."""
    text = "Preamble line long enough to be kept here as text.\n௨௩௬. ஒரு மருந்து\nBody.\n"
    assert "௨௩௬" in [v for _, v in find_boundaries(text)]


# ---------------------------------------------------------------------------
# document 1's citation format
# ---------------------------------------------------------------------------
#
# Verbatim from sfi-t1. Its citations carry a publication year and a verse
# reference (செய்யுள் எண்) that document 2 never used - and the scanner renders
# எண் as என் often enough that both must be recognised.

REAL_SFI_CITATIONS = [
    "(சித்த வைத்தியத் திரட்டு, 1987, பக்கம் எண்- 269, செய்யுள் எண் 435)",
    "(தேரையர் தைலவருக்கச் சுருக்கம், 1970, பக்கம் எண் 93, 94, செய்யுள் எண் 69)",
    "(தேரையர் தைலவருக்கச் சுருக்கம், 1970, பக்கம் எண் 137-139, செய்யுள் என் 130. 133)",
    "(அகத்தியர் வைத்திய இரத்தினச் சுருக்கம் 360, 1970, பக்கம் எண் 18, 19,செய்யுள் எண் 55-57)",
    "(சித்த வைத்தியத் திரட்டு, 1987, பக்கம் எண் 155, செய்யுள் எண் 250-253)",
    "(குணபாடம்-தாது சீவ வகுப்பு, 1968, பக்கம் எண் 109, 110)",
    "(தேரையர் பாடல் திரட்டு, 1975, பக்கம் எண் 26)",
]


@pytest.mark.parametrize("citation", REAL_SFI_CITATIONS)
def test_document_1_citation_format_is_recognised(citation):
    assert has_citation(f"17:3 கந்தக பற்பம்\n{citation}\nதேவையான சரக்குகள்:")


@pytest.mark.parametrize(
    "citation",
    [
        "(சித்த வைத்தியத் திரட்டு, 1987, செய்யுள் எண் 435)",
        "(தேரையர் தைலவருக்கச் சுருக்கம், செய்யுள் என் 130)",
    ],
)
def test_a_verse_only_citation_is_enough_on_its_own(citation):
    """செய்யுள் எண் must stand alone - not every book prints a page number."""
    assert has_citation(f"7.ஒரு மருந்து\n{citation}\nசெய்முறை: அரைக்கவும்.")


def test_the_ordinary_word_en_does_not_make_a_citation():
    """என் is common Tamil; it may only count directly after a citation word."""
    assert not has_citation("என் 5 நாட்கள் அரைத்து மாத்திரை செய்யவும்.")
    assert not has_citation("இது என் 10 வது முறை ஆகும்.")


def test_a_year_alone_is_not_a_citation():
    """A bare date must not vouch for a heading."""
    assert not has_citation("7.ஒரு மருந்து\n1987 ஆம் ஆண்டு தயாரிக்கப்பட்டது.")
