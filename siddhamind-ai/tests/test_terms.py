"""tsquery construction.

The bug these lock down: ``plainto_tsquery`` ANDs every lexeme, and the 'simple'
configuration keeps stop words, so a natural-language question became a
conjunction no chunk could satisfy and keyword retrieval silently returned
nothing on every real query.
"""

import pytest

from app import textnorm
from app.retrieval import terms

from app.retrieval.terms import (
    STOP_WORDS,
    build_tsquery,
    matched_terms,
    meaningful_terms,
    tokenise,
)


def test_a_natural_question_produces_an_or_query_of_content_words():
    """The regression case. Under AND semantics this matched nothing, ever."""
    tsquery = build_tsquery("what are the ingredients of Thiripala Chooranam")
    assert tsquery == "ingredients:* | thiripala:* | chooranam:*"
    assert "&" not in tsquery


def test_tamil_is_tokenised_not_dropped():
    terms = meaningful_terms("நிலவேம்பு குடிநீர் அளவு என்ன")
    assert "நிலவேம்பு" in terms
    assert "குடிநீர்" in terms
    assert "என்ன" not in terms, "Tamil question words are stop words too"


def test_tamil_numerals_survive_as_searchable_terms():
    """௪௪ is a verse reference. Phase 4 confirmed the chunker detects it; the
    keyword index has to be able to find it."""
    assert build_tsquery("௪௪") == "௪௪"


def test_a_verse_number_query_is_preserved():
    # "verse" is kept: it is a content word that appears in the corpus, and OR
    # semantics mean ts_rank still favours chunks carrying the number itself.
    assert build_tsquery("verse 236") == "verse:* | 236"
    assert build_tsquery("236-237") == "236 | 237"


def test_stop_words_alone_yield_none_not_an_empty_string():
    """to_tsquery('') raises. None tells the caller to skip keyword search."""
    assert build_tsquery("what is the") is None
    assert build_tsquery("") is None
    assert build_tsquery("   ") is None


def test_punctuation_cannot_inject_tsquery_operators():
    """to_tsquery parses operators; a raw ! or & from user text would either
    error or silently change the query's meaning."""
    for hostile in ("dose & !ingredients", "dose | (bad:*)", "a ! b", "x:*"):
        tsquery = build_tsquery(hostile)
        if tsquery is None:
            continue
        for token in tsquery.split(" | "):
            body = token[:-2] if token.endswith(":*") else token
            for operator in ("&", "!", "(", ")", ":", "*", "<", ">"):
                assert operator not in body


def test_terms_are_deduplicated_preserving_order():
    assert build_tsquery("chooranam dose chooranam") == "chooranam:* | dose:*"


def test_case_is_normalised():
    assert build_tsquery("Thiripala CHOORANAM") == "thiripala:* | chooranam:*"


def test_single_latin_letters_are_dropped_but_digits_are_kept():
    assert meaningful_terms("dose g 2") == ["dose", "2"]


def test_single_tamil_character_is_kept():
    """A lone Tamil numeral is a legitimate reference; a lone Latin letter is not."""
    assert "௪" in meaningful_terms("௪")


@pytest.mark.parametrize("word", ["what", "the", "of", "is", "how", "என்ன", "எப்படி"])
def test_common_question_words_are_stop_words(word):
    assert word in STOP_WORDS


def test_tokenise_splits_on_punctuation_and_keeps_scripts():
    assert tokenise("dose: 2g, anupanam - தேன்.") == ["dose", "2g", "anupanam", "தேன்"]


def test_matched_terms_reports_what_actually_appeared():
    content = "101. Thiripala Chooranam. Ingredients: Kadukkai 35 g."
    assert matched_terms(content, ["thiripala", "kadukkai", "nilavembu"]) == [
        "thiripala", "kadukkai",
    ]


def test_matched_terms_is_substring_based_for_agglutinative_tamil():
    """சூரணம் inside சூரணத்தை is a hit a reader would expect to count."""
    assert matched_terms("திரிகடுகு சூரணத்தை எடுக்கவும்", ["சூரண"]) == ["சூரண"]


def test_mixed_language_question_keeps_both_scripts():
    tsquery = build_tsquery("what is the dose of நிலவேம்பு")
    assert tsquery == "dose:* | நிலவேம்பு:*"


# --------------------------------------------------------------------------
# OCR and text-layer forms of the same word must converge
# --------------------------------------------------------------------------


def test_ocr_and_text_layer_tamil_normalise_to_the_same_terms():
    """Tesseract appends U+200C after Tamil word-final consonants; a PDF text
    layer does not. The two look identical on screen. If they survive into the
    index and the query unchanged, a search for the word matches one source and
    silently misses the other."""
    from app.ingestion.chunker import clean_page_text

    text_layer = "நிலவேம்பு குடிநீர் அளவு"
    ocr = "நிலவேம்பு\u200c குடிநீர்\u200c அளவு"

    assert text_layer != ocr, "the fixture must actually differ before normalisation"
    assert clean_page_text(ocr) == clean_page_text(text_layer)
    assert tokenise(ocr) == tokenise(text_layer)
    assert build_tsquery(ocr) == build_tsquery(text_layer)


def test_a_query_matches_regardless_of_which_source_indexed_it():
    """The end-to-end property: one tsquery term, whichever path produced it."""
    from app.ingestion.chunker import clean_page_text

    indexed_from_ocr = clean_page_text("42. நிலவேம்பு\u200c குடிநீர்\u200c")
    asked_plainly = build_tsquery("குடிநீர்", prefix=False)

    assert asked_plainly is not None
    assert asked_plainly in indexed_from_ocr.lower()


@pytest.mark.parametrize("invisible", ["\u200b", "\u200c", "\u200d", "\u2060", "\ufeff", "\u00ad"])
def test_every_zero_width_character_is_stripped(invisible):
    from app.textnorm import normalise

    assert normalise(f"குடி{invisible}நீர்") == "குடிநீர்"


def test_normalisation_does_not_merge_genuinely_different_words():
    """Stripping invisibles must not make distinct Tamil words collide."""
    from app.textnorm import normalise

    assert normalise("சூரணம்") != normalise("சுண்ணம்")
    assert normalise("குடிநீர்") != normalise("குடிநீ")


def test_nfc_and_invisible_stripping_are_both_applied():
    import unicodedata
    from app.textnorm import normalise

    decomposed_with_zwnj = unicodedata.normalize("NFD", "நீர்") + "\u200c"
    assert normalise(decomposed_with_zwnj) == unicodedata.normalize("NFC", "நீர்")


# ---------------------------------------------------------------------------
# Tamil vowel-length folding and prefix matching
# ---------------------------------------------------------------------------


def test_folding_makes_the_ocr_confusion_compare_equal():
    """ூ and ு differ by a loop; Tesseract swaps them across the whole corpus."""
    assert textnorm.fold_vowel_length("சூரணம்") == textnorm.fold_vowel_length("சுரணம்")


def test_folding_is_not_part_of_normalise():
    """Storage keeps the real spelling - only comparison is folded.

    Folding in normalise() would rewrite doc_chunks.content into a misspelling
    of itself and show that to practitioners.
    """
    assert textnorm.normalise("சூரணம்") == "சூரணம்"
    assert "ூ" in textnorm.normalise("சூரணம்")


def test_the_consonant_confusions_are_left_alone():
    """ச/த and ம/ற collide real words, so they are corrected by dictionary only."""
    assert textnorm.fold_vowel_length("சரம்") != textnorm.fold_vowel_length("தரம்")
    assert textnorm.fold_vowel_length("மரம்") != textnorm.fold_vowel_length("றரம்")


def test_query_and_content_fold_to_the_same_form():
    """The SQL fold must mirror the Python one or nothing matches."""
    src, dst = textnorm.SQL_VOWEL_LENGTH_FOLD
    assert textnorm.fold_vowel_length(src) == dst


def test_the_correction_dictionary_maps_the_confirmed_pair():
    q = terms.build_tsquery("சுரணம் அளவு என்ன")
    assert q is not None
    # corrected to சூரணம், then folded - so it meets the indexed folded form
    assert terms.textnorm.fold_vowel_length("சூரணம்") in q


def test_a_misread_query_finds_the_correctly_spelled_term():
    assert terms.build_tsquery("சுரணம்") == terms.build_tsquery("சூரணம்")


# --- prefix matching -------------------------------------------------------


def test_aksharas_counts_syllables_not_codepoints():
    """வெள் is four codepoints but two syllables - the unit that matters."""
    assert terms.aksharas("வெள்") == ["வெ", "ள்"]
    assert terms.aksharas("சூரண") == ["சூ", "ர", "ண"]


def test_a_stem_query_now_reaches_the_full_word():
    """The gap this closes: சூரண returned nothing though சூரணம் is in the text."""
    q = terms.build_tsquery("சூரண")
    assert q is not None and q.endswith(":*")


def test_short_terms_are_never_prefix_matched():
    """வெள் alone opens silver, tin, zinc and goat's milk - four substances."""
    q = terms.build_tsquery("வெள்")
    assert q is not None and ":*" not in q


def test_terms_are_never_truncated_to_a_stem():
    """Truncating produced 3.99 spurious matches per query on real vocabulary.

    The whole term is kept and marked; only the reader may supply a stem.
    """
    q = terms.build_tsquery("வெள்வங்கம்")
    assert q is not None
    assert q.startswith(textnorm.fold_vowel_length("வெள்வங்கம்"))
    assert "வெள்:*" not in q


def test_prefix_can_be_turned_off():
    assert ":*" not in (terms.build_tsquery("சூரணம் அளவு", prefix=False) or "")


def test_no_tsquery_operator_survives_from_user_text():
    """:* is appended after sanitising; nothing else may introduce an operator."""
    q = terms.build_tsquery("சூரணம் & (அளவு) | !தீரும்:*")
    assert q is not None
    for token in q.split(" | "):
        body = token[:-2] if token.endswith(":*") else token
        assert not set(body) & set("&|!():*")
