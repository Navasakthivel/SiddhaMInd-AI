"""Corpus path resolution and the traversal guard.

file_path is a database column an admin edits, so it is untrusted input. These
tests use real files in tmp_path because the guard compares *resolved* paths -
mocking the filesystem would test a different function than the one that ships.
"""

import pytest

from app.ingestion.paths import (
    PdfNotFoundError,
    candidate_paths,
    is_contained,
    resolve_pdf,
)


@pytest.fixture
def corpus(tmp_path):
    """A corpus dir, an upload dir, and a secret outside both."""
    corpus_dir = tmp_path / "corpus"
    upload_dir = tmp_path / "uploads"
    corpus_dir.mkdir()
    upload_dir.mkdir()
    (corpus_dir / "Siddha TERM 1 SFI preparations.pdf").write_bytes(b"%PDF-1.4\n")
    (upload_dir / "uploaded.pdf").write_bytes(b"%PDF-1.4\n")
    (tmp_path / "secret.pdf").write_bytes(b"%PDF-1.4\n")
    return corpus_dir, upload_dir, tmp_path


# --------------------------------------------------------------------------
# finding the file
# --------------------------------------------------------------------------


def test_finds_a_file_stored_with_its_corpus_prefix(corpus):
    """The seed data stores 'corpus/Book.pdf' while CORPUS_DIR is already
    './corpus' - a naive join gives corpus/corpus/Book.pdf."""
    corpus_dir, upload_dir, _ = corpus
    found = resolve_pdf(
        "corpus/Siddha TERM 1 SFI preparations.pdf", str(corpus_dir), str(upload_dir)
    )
    assert found == (corpus_dir / "Siddha TERM 1 SFI preparations.pdf").resolve()


def test_finds_a_file_stored_as_a_bare_name(corpus):
    corpus_dir, upload_dir, _ = corpus
    found = resolve_pdf("Siddha TERM 1 SFI preparations.pdf", str(corpus_dir), str(upload_dir))
    assert found.name == "Siddha TERM 1 SFI preparations.pdf"


def test_finds_a_file_in_the_upload_directory(corpus):
    corpus_dir, upload_dir, _ = corpus
    assert resolve_pdf("uploaded.pdf", str(corpus_dir), str(upload_dir)).name == "uploaded.pdf"


def test_accepts_an_absolute_path_inside_a_root(corpus):
    corpus_dir, upload_dir, _ = corpus
    target = corpus_dir / "Siddha TERM 1 SFI preparations.pdf"
    assert resolve_pdf(str(target), str(corpus_dir), str(upload_dir)) == target.resolve()


def test_surrounding_whitespace_is_tolerated(corpus):
    corpus_dir, upload_dir, _ = corpus
    assert resolve_pdf("  uploaded.pdf  ", str(corpus_dir), str(upload_dir)).name == "uploaded.pdf"


# --------------------------------------------------------------------------
# the guard
# --------------------------------------------------------------------------


def test_traversal_out_of_the_corpus_is_refused(corpus):
    """../secret.pdf resolves to a real, readable file - the guard is the only
    thing stopping it being OCR'd into the corpus."""
    corpus_dir, upload_dir, _ = corpus
    with pytest.raises(PdfNotFoundError) as excinfo:
        resolve_pdf("../secret.pdf", str(corpus_dir), str(upload_dir))
    assert "rejected" in str(excinfo.value)


def test_deep_traversal_is_refused(corpus):
    corpus_dir, upload_dir, _ = corpus
    with pytest.raises(PdfNotFoundError):
        resolve_pdf("../../../../../../etc/passwd", str(corpus_dir), str(upload_dir))


def test_absolute_path_outside_the_roots_is_refused(corpus):
    corpus_dir, upload_dir, tmp_path = corpus
    with pytest.raises(PdfNotFoundError):
        resolve_pdf(str(tmp_path / "secret.pdf"), str(corpus_dir), str(upload_dir))


def test_is_contained_rejects_a_sibling_with_a_shared_prefix(tmp_path):
    """The string-prefix version of this check passes /corpus-backup against
    /corpus. Comparing resolved parents does not."""
    root = tmp_path / "corpus"
    sibling = tmp_path / "corpus-backup"
    root.mkdir()
    sibling.mkdir()
    assert is_contained(root / "a.pdf", [root]) is True
    assert is_contained(sibling / "a.pdf", [root]) is False


def test_is_contained_accepts_the_root_itself(tmp_path):
    assert is_contained(tmp_path, [tmp_path]) is True


# --------------------------------------------------------------------------
# failure messages
# --------------------------------------------------------------------------


def test_missing_file_names_the_directories_searched(corpus):
    corpus_dir, upload_dir, _ = corpus
    with pytest.raises(PdfNotFoundError) as excinfo:
        resolve_pdf("nowhere.pdf", str(corpus_dir), str(upload_dir))
    message = str(excinfo.value)
    assert str(corpus_dir) in message and str(upload_dir) in message


@pytest.mark.parametrize("empty", [None, "", "   "])
def test_empty_file_path_is_reported_clearly(empty, corpus):
    corpus_dir, upload_dir, _ = corpus
    with pytest.raises(PdfNotFoundError, match="empty"):
        resolve_pdf(empty, str(corpus_dir), str(upload_dir))


def test_a_directory_is_not_mistaken_for_the_pdf(corpus):
    """corpus/sub exists as a directory; only is_file() should satisfy it."""
    corpus_dir, upload_dir, _ = corpus
    (corpus_dir / "sub").mkdir()
    with pytest.raises(PdfNotFoundError):
        resolve_pdf("sub", str(corpus_dir), str(upload_dir))


def test_candidate_order_prefers_the_corpus_root(tmp_path):
    roots = [tmp_path / "corpus", tmp_path / "uploads"]
    candidates = candidate_paths("corpus/Book.pdf", roots)
    assert candidates[0] == roots[0] / "corpus/Book.pdf"
    assert roots[0] / "Book.pdf" in candidates
