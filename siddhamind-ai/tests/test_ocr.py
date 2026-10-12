"""OCR gate tests against mocked Tesseract output. No Tesseract, no PDF.

The rule under test is the one the spec is strictest about: a page may be left
out of the index, but never without a record of why.
"""

import pytest

from app.ingestion.ocr import (
    MAX_DESKEW_DEGREES,
    OcrUnavailableError,
    PageResult,
    assess_ocr,
    check_binaries,
    has_text_layer,
    mean_confidence,
    require_binaries,
    summarise,
    tamil_ratio,
    text_from_data,
)


def tesseract_data(confidences, words=None):
    """Shape of pytesseract.image_to_data(output_type=Output.DICT)."""
    return {
        "conf": confidences,
        "text": words or ["word"] * len(confidences),
        "level": [5] * len(confidences),
    }


# --------------------------------------------------------------------------
# confidence arithmetic
# --------------------------------------------------------------------------


def test_mean_confidence_averages_word_scores():
    assert mean_confidence(tesseract_data([90, 80, 70])) == 80.0


def test_layout_boxes_scored_minus_one_are_excluded():
    """Tesseract scores block/paragraph/line boxes -1. Averaging them in would
    fail pages that read perfectly well."""
    with_layout = mean_confidence(tesseract_data([-1, -1, -1, 90, 80, 70]))
    assert with_layout == 80.0


def test_string_confidences_are_parsed():
    """image_to_data returns strings under some pytesseract versions."""
    assert mean_confidence(tesseract_data(["90", "80", "70"])) == 80.0


def test_unparseable_values_are_ignored_not_counted_as_zero():
    assert mean_confidence(tesseract_data([90, None, "n/a", 70])) == 80.0


def test_no_words_returns_none_not_zero():
    """None means 'nothing recognised', which is a different condition from
    'recognised badly' and is reported with a different reason."""
    assert mean_confidence(tesseract_data([])) is None
    assert mean_confidence(tesseract_data([-1, -1])) is None
    assert mean_confidence({}) is None


# --------------------------------------------------------------------------
# the gate
# --------------------------------------------------------------------------


def test_confident_page_is_kept():
    result = assess_ocr(12, "நிலவேம்பு குடிநீர்", confidence=82.0, min_confidence=45.0)
    assert result.skipped is False
    assert result.text == "நிலவேம்பு குடிநீர்"
    assert result.confidence == 82.0
    assert result.source == "ocr"
    assert result.reason is None


def test_low_confidence_page_is_recorded_not_dropped():
    result = assess_ocr(37, "garbled text", confidence=22.5, min_confidence=45.0)
    assert result.skipped is True
    assert result.page_no == 37
    assert result.text == ""
    # The reason must name both numbers - an operator needs to know whether to
    # rescan the page or lower the threshold.
    assert "22.5" in result.reason and "45.0" in result.reason


def test_page_exactly_at_the_threshold_is_kept():
    """>= not >, so a threshold of 45 keeps a page scoring exactly 45."""
    assert assess_ocr(1, "text", confidence=45.0, min_confidence=45.0).skipped is False


def test_just_below_the_threshold_is_skipped():
    assert assess_ocr(1, "text", confidence=44.9, min_confidence=45.0).skipped is True


def test_blank_page_is_recorded_with_its_own_reason():
    result = assess_ocr(5, "", confidence=None, min_confidence=45.0)
    assert result.skipped is True
    assert "blank page or failed OCR" in result.reason


def test_high_confidence_but_empty_text_is_still_skipped():
    """Confident about nothing: boxes scored well, no characters survived.
    Must not pass as a legitimately empty page."""
    result = assess_ocr(9, "   \n  ", confidence=95.0, min_confidence=45.0)
    assert result.skipped is True
    assert "no usable characters" in result.reason


@pytest.mark.parametrize("confidence", [0.0, 1.0, 44.0])
def test_every_skip_carries_a_reason(confidence):
    result = assess_ocr(1, "x", confidence=confidence, min_confidence=45.0)
    assert result.skipped and result.reason, "a skip without a reason is a silent drop"


# --------------------------------------------------------------------------
# text-layer detection
# --------------------------------------------------------------------------


def test_born_digital_page_uses_its_text_layer():
    assert has_text_layer("a" * 500, min_chars=120) is True


def test_scanner_artefacts_do_not_count_as_a_text_layer():
    """A scanned page often still yields a stamped page number. Treating that as
    a text layer would return three characters for a full page of Tamil."""
    assert has_text_layer("  37  ", min_chars=120) is False
    assert has_text_layer("", min_chars=120) is False
    assert has_text_layer(None, min_chars=120) is False


def test_threshold_is_on_stripped_length():
    assert has_text_layer(" " * 400 + "short", min_chars=120) is False


# --------------------------------------------------------------------------
# per-document summary
# --------------------------------------------------------------------------


def test_summarise_counts_each_bucket():
    results = [
        PageResult(1, "text", "text-layer"),
        PageResult(2, "text", "ocr", confidence=80.0),
        PageResult(3, "text", "ocr", confidence=90.0),
        PageResult(4, "", "ocr", confidence=10.0, skipped=True, reason="low"),
        PageResult(5, "", "ocr", skipped=True, reason="blank"),
    ]
    stats = summarise(results)
    assert stats["pages"] == 5
    assert stats["text_layer"] == 1
    assert stats["ocr"] == 2
    assert stats["skipped"] == 2
    assert stats["skipped_pages"] == [4, 5]
    # Skipped pages must not drag the reported quality of what was kept.
    assert stats["mean_confidence"] == 85.0


def test_summarise_totals_account_for_every_page():
    """kept + skipped == pages, always. This is the no-silent-loss invariant."""
    results = [
        PageResult(1, "t", "text-layer"),
        PageResult(2, "t", "ocr", confidence=70.0),
        PageResult(3, "", "ocr", confidence=5.0, skipped=True, reason="low"),
    ]
    stats = summarise(results)
    assert stats["text_layer"] + stats["ocr"] + stats["skipped"] == stats["pages"]


def test_summarise_handles_an_empty_document():
    assert summarise([])["pages"] == 0
    assert summarise([])["mean_confidence"] is None


def test_page_result_is_immutable():
    with pytest.raises(Exception):
        PageResult(1, "t", "ocr").text = "rewritten"  # type: ignore[misc]


# --------------------------------------------------------------------------
# binary probing
# --------------------------------------------------------------------------


def test_check_binaries_reports_rather_than_raising():
    """A probe that throws is useless to the endpoint that calls it to decide
    whether to return 503."""
    status = check_binaries()
    assert isinstance(status, dict)
    assert "ok" in status


def test_check_binaries_never_claims_ok_without_both():
    status = check_binaries()
    if status["ok"]:
        assert status["tesseract"] and status["poppler"]
    else:
        assert status["tesseract"] is None or status["poppler"] is None


def test_poppler_probe_looks_for_the_binary_not_the_wrapper():
    """pdf2image is a wrapper that shells out to pdftoppm. A bogus poppler_path
    must fail even when the Python package imports fine - otherwise
    `pip install` alone passes the check and ingestion dies mid-run."""
    status = check_binaries(poppler_path="/definitely/not/a/real/poppler/dir")
    assert status["poppler"] is None
    assert "poppler_error" in status


def test_require_binaries_message_says_what_to_install():
    status = check_binaries()
    if status["ok"]:
        pytest.skip("Tesseract and poppler are both installed here")
    with pytest.raises(OcrUnavailableError) as excinfo:
        require_binaries()
    message = str(excinfo.value)
    assert "TESSERACT_CMD" in message and "POPPLER_PATH" in message


def test_deskew_cap_is_sane():
    """An unbounded angle estimate can rotate a page of figures by 40 degrees
    and destroy it; the cap is what makes deskew safe to apply blindly."""
    assert 5.0 <= MAX_DESKEW_DEGREES <= 20.0


# --------------------------------------------------------------------------
# reconstructing page text from a single Tesseract pass
# --------------------------------------------------------------------------


def layout_data(rows):
    """image_to_data shape: (block, paragraph, line, word, confidence)."""
    return {
        "block_num": [r[0] for r in rows],
        "par_num": [r[1] for r in rows],
        "line_num": [r[2] for r in rows],
        "text": [r[3] for r in rows],
        "conf": [r[4] for r in rows],
    }


def test_words_on_one_line_are_joined_with_spaces():
    data = layout_data([(1, 1, 1, "Thiripala", 92), (1, 1, 1, "Chooranam", 90)])
    assert text_from_data(data) == "Thiripala Chooranam"


def test_line_breaks_are_preserved():
    """The chunker finds verse markers at the START OF A LINE. Flattening the
    page to one long line would hide every structural boundary and silently
    push the whole document onto the sliding-window fallback."""
    data = layout_data([
        (1, 1, 1, "101.", 95), (1, 1, 1, "Thiripala", 92),
        (1, 1, 2, "Dose:", 88), (1, 1, 2, "2", 90), (1, 1, 2, "g", 85),
    ])
    assert text_from_data(data) == "101. Thiripala\nDose: 2 g"


def test_a_new_paragraph_gets_a_blank_line():
    data = layout_data([
        (1, 1, 1, "First", 90),
        (1, 2, 1, "Second", 90),
    ])
    assert text_from_data(data) == "First\n\nSecond"


def test_layout_boxes_scored_minus_one_are_not_words():
    data = layout_data([
        (1, 1, 1, "", -1), (1, 1, 1, "real", 90), (1, 1, 1, "", -1),
    ])
    assert text_from_data(data) == "real"


def test_empty_data_yields_empty_text():
    assert text_from_data({}) == ""
    assert text_from_data(layout_data([])) == ""


def test_text_and_confidence_come_from_the_same_pass():
    """Both derive from one image_to_data dict, so the score always describes
    the text it gated - two separate Tesseract runs could disagree."""
    data = layout_data([(1, 1, 1, "word", 80), (1, 1, 1, "other", 60)])
    assert text_from_data(data) == "word other"
    assert mean_confidence(data) == 70.0


# --------------------------------------------------------------------------
# legacy glyph-mapped Tamil fonts: character count is not proof of a text layer
# --------------------------------------------------------------------------

# Extracted verbatim by pypdf from page 1 of the real corpus PDF
# "Siddha marunthakaviyal.pdf", whose body font is /DBLHTB+SunAnand with
# /WinAnsiEncoding and NO /ToUnicode CMap. It renders on screen as
# "சித்த மருந்தாக்கவியல்"; what is actually stored is Latin.
SUNANAND_PAGE_1 = (
    "Fzghlk; kUe;jhf;ftpay; - II SECOND PROFESSIONAL B.S.MS. "
    "jahhpg;G Kiwfs; kw;Wk; kUe;Jfs; gl;bay; "
    "nghUl;fs; Rj;jp Kiw nra;Kiw mstpay;"
)

# A real Tamil text layer from a PDF that does carry a ToUnicode CMap.
GENUINE_TAMIL_PAGE = (
    "சித்த மருந்தாக்கவியல் - இரண்டாம் ஆண்டு "
    "தயாரிப்பு முறைகள் மற்றும் மருந்துகள் பட்டியல் "
    "பொருட்கள் சுத்தி முறை செய்முறை அளவியல்"
)


def test_the_old_count_only_check_would_have_accepted_the_garbage():
    """Establishes the bug this guard exists for.

    The legacy text is long enough to clear any length threshold, so a check
    based on character count alone kept it - and those Latin codepoints would
    have been embedded, indexed, retrieved and cited to a practitioner as
    though they were the book.
    """
    assert len(SUNANAND_PAGE_1) >= 120, "fixture must clear the length threshold"
    # This is exactly what the old implementation did.
    assert (bool(SUNANAND_PAGE_1) and len(SUNANAND_PAGE_1.strip()) >= 120) is True


def test_glyph_mapped_tamil_is_routed_to_ocr():
    assert has_text_layer(SUNANAND_PAGE_1, 120, expect_tamil=True) is False


def test_a_genuine_tamil_text_layer_is_kept():
    """The counterpart, so the guard cannot pass by rejecting everything."""
    assert has_text_layer(GENUINE_TAMIL_PAGE, 120, expect_tamil=True) is True


def test_tamil_ratio_separates_the_two():
    garbage, _ = tamil_ratio(SUNANAND_PAGE_1)
    genuine, _ = tamil_ratio(GENUINE_TAMIL_PAGE)
    assert garbage == 0.0
    assert genuine > 0.9


def test_an_english_document_is_not_forced_through_ocr():
    """expect_tamil is off for an English book, so a 0%-Tamil page is fine.
    Forcing Park's 932 pages through OCR to satisfy a Tamil rule would be
    expensive and would lower quality on text that extracts perfectly."""
    english = "Preventive and social medicine. " * 8
    assert has_text_layer(english, 120, expect_tamil=False) is True


def test_a_mixed_page_with_real_tamil_is_kept():
    """Real books interleave English headings with Tamil body text."""
    mixed = ("SECOND PROFESSIONAL B.S.MS. Paper II "
             "சித்த மருந்தாக்கவியல் தயாரிப்பு முறைகள் மற்றும் "
             "மருந்துகள் பட்டியல் பொருட்கள் சுத்தி முறை செய்முறை")
    ratio, _ = tamil_ratio(mixed)
    assert 0.30 <= ratio < 1.0, f"fixture should be genuinely mixed, got {ratio:.2f}"
    assert has_text_layer(mixed, 120, expect_tamil=True) is True


def test_a_page_with_too_few_letters_is_judged_on_length_alone():
    """A page of numerals - a dosage or proportion table - carries almost no
    alphabetic content, so a script ratio computed over it would be noise rather
    than evidence. The length check decides those on its own."""
    numeric = "1. 35   2. 35   3. 35   4. 100   5. 240   6. 60   7. 30   " * 3
    ratio, letters = tamil_ratio(numeric)
    assert len(numeric) >= 120, "fixture must clear the length threshold"
    assert letters < 20, f"fixture should be letter-sparse, has {letters}"
    assert has_text_layer(numeric, 120, expect_tamil=True) is True


def test_the_short_watermark_pages_still_fail_on_length():
    """67 of the 69 pages in the real document extract only '_YS_2022'."""
    assert has_text_layer("_YS_2022", 120, expect_tamil=True) is False
    assert has_text_layer("_YS_2022", 120, expect_tamil=False) is False


def test_the_ratio_threshold_is_configurable():
    # A stricter setting rejects a page that the default would keep.
    mixed = "ABCDEFGHIJKLMNOPQRST " + "சித்த மருந்தாக்கவியல் தயாரிப்பு " * 4
    assert has_text_layer(mixed, 120, expect_tamil=True, min_tamil_ratio=0.30) is True
    assert has_text_layer(mixed, 120, expect_tamil=True, min_tamil_ratio=0.95) is False
