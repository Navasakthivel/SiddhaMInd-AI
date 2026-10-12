"""Embedder tests with a fake encoder. No torch, no 2 GB download.

The point of these is the dimension guard: a wrong-width vector must raise
before it reaches asyncpg, not after a whole book has been OCR'd.
"""

import pytest

from app.ingestion.embedder import (
    EmbeddingDimensionError,
    embed_chunks,
    embed_passages,
    embed_queries,
    model_dimension,
    passage_prefix,
    query_prefix,
    validate_dimensions,
)


class FakeEncoder:
    """Stands in for SentenceTransformer.

    ``width`` is what it actually returns; ``declared`` is what it claims via
    get_sentence_embedding_dimension. Setting them apart simulates a model whose
    config disagrees with its output.
    """

    def __init__(self, width=1024, declared=None, record=None):
        self.width = width
        self.declared = width if declared is None else declared
        self.calls = []
        self.record = record if record is not None else []

    def get_sentence_embedding_dimension(self):
        return self.declared

    def encode(self, texts, **kwargs):
        self.calls.append({"texts": list(texts), **kwargs})
        self.record.extend(texts)
        return [[0.01 * (i + 1)] * self.width for i, _ in enumerate(texts)]


class WidthDriftEncoder(FakeEncoder):
    """Correct on the first batch, wrong on the second.

    This is the realistic failure - a truncation or pooling bug that only shows
    on certain inputs - and it is the one a startup-only check cannot catch.
    """

    def __init__(self, good_width=1024, bad_width=768, switch_after=1):
        super().__init__(width=good_width)
        self.bad_width = bad_width
        self.switch_after = switch_after
        self.batches = 0

    def encode(self, texts, **kwargs):
        self.batches += 1
        width = self.width if self.batches <= self.switch_after else self.bad_width
        return [[0.5] * width for _ in texts]


# --------------------------------------------------------------------------
# the dimension guard
# --------------------------------------------------------------------------


def test_correct_width_passes():
    validate_dimensions([[0.0] * 1024, [1.0] * 1024], expected=1024)


def test_wrong_width_raises_with_an_actionable_message():
    with pytest.raises(EmbeddingDimensionError) as excinfo:
        validate_dimensions([[0.0] * 384], expected=1024)
    message = str(excinfo.value)
    assert "384" in message and "1024" in message
    assert "ALTER TABLE" in message, "the operator needs to know what fixing it costs"


def test_the_offending_position_is_named():
    with pytest.raises(EmbeddingDimensionError, match="embedding 2"):
        validate_dimensions([[0.0] * 1024, [0.0] * 1024, [0.0] * 512], expected=1024)


def test_empty_input_is_not_an_error():
    validate_dimensions([], expected=1024)


def test_declared_mismatch_is_caught_before_any_encoding():
    """A model that declares 384 against a vector(1024) column should fail in
    milliseconds, not after embedding a book."""
    encoder = FakeEncoder(width=384)
    with pytest.raises(EmbeddingDimensionError, match="384"):
        embed_passages(["one", "two"], expected_dim=1024, model=encoder, model_name="fake")
    assert encoder.calls == [], "nothing should have been encoded"


def test_drift_mid_run_is_caught_at_the_batch_that_drifts():
    """The startup schema probe cannot see this - it checks config against the
    column, not what the model returns per batch."""
    encoder = WidthDriftEncoder(good_width=1024, bad_width=768, switch_after=1)
    with pytest.raises(EmbeddingDimensionError, match="768"):
        embed_passages(
            [f"chunk {i}" for i in range(10)],
            expected_dim=1024,
            model=encoder,
            model_name="drifting",
            batch_size=2,
        )
    assert encoder.batches == 2, "it should stop at the bad batch, not finish the run"


def test_nothing_is_returned_when_the_guard_trips():
    """embed_chunks must not leave a partial 'embedding' key behind for the
    caller to write."""
    chunks = [{"content": f"c{i}", "chunk_index": i} for i in range(6)]
    encoder = WidthDriftEncoder(good_width=1024, bad_width=100, switch_after=1)
    with pytest.raises(EmbeddingDimensionError):
        embed_chunks(chunks, expected_dim=1024, model=encoder, batch_size=2)
    assert all("embedding" not in c for c in chunks)


# --------------------------------------------------------------------------
# batching and ordering
# --------------------------------------------------------------------------


def test_texts_are_encoded_in_batches_not_one_at_a_time():
    encoder = FakeEncoder(width=8)
    embed_passages(
        [f"t{i}" for i in range(10)], expected_dim=8, model=encoder, batch_size=4
    )
    assert [len(c["texts"]) for c in encoder.calls] == [4, 4, 2]


def test_order_is_preserved_across_batches():
    seen = []
    encoder = FakeEncoder(width=8, record=seen)
    texts = [f"t{i}" for i in range(7)]
    embed_passages(texts, expected_dim=8, model=encoder, batch_size=3)
    assert seen == texts, "embed_chunks zips by position; order is load-bearing"


def test_embeddings_are_attached_to_the_right_chunks():
    chunks = [{"content": f"c{i}", "chunk_index": i} for i in range(5)]
    encoder = FakeEncoder(width=4)
    out = embed_chunks(chunks, expected_dim=4, model=encoder, batch_size=2)
    assert len(out) == 5
    for chunk in out:
        assert len(chunk["embedding"]) == 4
        assert chunk["chunk_index"] == chunks[chunk["chunk_index"]]["chunk_index"]


def test_vectors_are_normalised_for_cosine():
    encoder = FakeEncoder(width=8)
    embed_passages(["x"], expected_dim=8, model=encoder)
    assert encoder.calls[0]["normalize_embeddings"] is True


def test_empty_input_short_circuits():
    encoder = FakeEncoder()
    assert embed_passages([], expected_dim=1024, model=encoder) == []
    assert embed_chunks([], expected_dim=1024, model=encoder) == []
    assert encoder.calls == []


def test_numpy_style_output_is_converted():
    """A real encoder returns an ndarray; the guard and asyncpg both want lists."""

    class ArrayLike:
        def __init__(self, rows):
            self._rows = rows

        def tolist(self):
            return self._rows

    class NumpyishEncoder(FakeEncoder):
        def encode(self, texts, **kwargs):
            return ArrayLike([[0.1] * self.width for _ in texts])

    out = embed_passages(["a", "b"], expected_dim=4, model=NumpyishEncoder(width=4))
    assert out == [[0.1] * 4, [0.1] * 4]
    assert isinstance(out[0], list)


def test_count_mismatch_refuses_to_zip():
    class DroppingEncoder(FakeEncoder):
        def encode(self, texts, **kwargs):
            return [[0.0] * self.width for _ in list(texts)[:-1]]  # loses one

    chunks = [{"content": f"c{i}"} for i in range(4)]
    with pytest.raises(EmbeddingDimensionError, match="refusing to zip"):
        embed_chunks(chunks, expected_dim=8, model=DroppingEncoder(width=8), batch_size=4)


# --------------------------------------------------------------------------
# model-specific prefixes
# --------------------------------------------------------------------------


def test_e5_gets_its_asymmetric_prefixes():
    """e5 was trained with them and loses measurable quality without."""
    assert passage_prefix("intfloat/multilingual-e5-large") == "passage: "
    assert query_prefix("intfloat/multilingual-e5-large") == "query: "


def test_bge_m3_gets_none():
    """bge-m3 was not trained with prefixes; adding one embeds a literal word."""
    assert passage_prefix("BAAI/bge-m3") == ""
    assert query_prefix("BAAI/bge-m3") == ""


def test_prefix_is_actually_applied_to_the_encoded_text():
    seen = []
    encoder = FakeEncoder(width=4, record=seen)
    embed_passages(
        ["நிலவேம்பு"],
        expected_dim=4,
        model=encoder,
        model_name="intfloat/multilingual-e5-large",
    )
    assert seen == ["passage: நிலவேம்பு"]


def test_no_prefix_leaves_text_untouched():
    seen = []
    encoder = FakeEncoder(width=4, record=seen)
    embed_passages(["நிலவேம்பு"], expected_dim=4, model=encoder, model_name="BAAI/bge-m3")
    assert seen == ["நிலவேம்பு"]


def test_queries_get_the_query_prefix_not_the_passage_one():
    """The asymmetry is the point: a question encoded as a passage retrieves
    worse, and nothing about the output says so."""
    seen = []
    encoder = FakeEncoder(width=4, record=seen)
    embed_queries(
        ["நிலவேம்பு அளவு"],
        expected_dim=4,
        model=encoder,
        model_name="intfloat/multilingual-e5-large",
    )
    assert seen == ["query: நிலவேம்பு அளவு"]


def test_query_prefix_is_not_stacked_on_top_of_the_passage_prefix():
    """Regression: embed_queries must not fall through to the cached model name
    and add 'passage: ' as well, producing 'passage: query: ...'."""
    seen = []
    encoder = FakeEncoder(width=4, record=seen)
    embed_queries(
        ["dose"], expected_dim=4, model=encoder,
        model_name="intfloat/multilingual-e5-large",
    )
    assert seen == ["query: dose"]
    assert "passage:" not in seen[0]


def test_bge_queries_get_no_prefix_either():
    seen = []
    encoder = FakeEncoder(width=4, record=seen)
    embed_queries(["dose"], expected_dim=4, model=encoder, model_name="BAAI/bge-m3")
    assert seen == ["dose"]


def test_queries_are_dimension_checked_like_passages():
    with pytest.raises(EmbeddingDimensionError):
        embed_queries(["x"], expected_dim=1024, model=FakeEncoder(width=384))


def test_model_dimension_handles_a_model_without_the_getter():
    assert model_dimension(object()) is None
