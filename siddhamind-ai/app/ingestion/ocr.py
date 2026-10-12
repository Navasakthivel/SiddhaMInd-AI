"""PDF to page text: existing text layer where there is one, Tesseract where not.

Heavy dependencies (pypdf, cv2, pytesseract, pdf2image, numpy) are imported
inside the functions that use them, not at module scope. Two reasons that is
worth the small awkwardness:

* ``/health`` stays answerable on a box where torch and OpenCV are missing, so a
  broken install reports itself instead of failing to boot.
* the confidence and text-layer logic below is then importable - and therefore
  unit-testable against mocked Tesseract output - with nothing installed.

Nothing here drops a page quietly. A page that cannot be read becomes a
:class:`PageResult` with ``skipped=True`` and a reason, which the pipeline
counts into ``source_documents.skipped_pages`` and logs individually.
"""

from __future__ import annotations

import logging
import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator, Sequence

log = logging.getLogger(__name__)

# Beyond this the angle estimate is almost certainly a misdetection - a figure,
# a table rule, or a page edge caught by the contour pass. Rotating a page by a
# wrongly-measured 40 degrees destroys it, so an implausible angle is discarded
# rather than trusted.
MAX_DESKEW_DEGREES = 15.0


class OcrUnavailableError(RuntimeError):
    """Raised when Tesseract or poppler cannot be reached.

    Surfaced as a FAILED ingest with this message rather than an exception deep
    in a background task, where it would otherwise reach the admin dashboard as
    a bare stack trace.
    """


@dataclass(frozen=True)
class PageResult:
    """One page's outcome. Every page of the PDF produces exactly one of these."""

    page_no: int
    text: str
    source: str  # "text-layer" | "ocr"
    confidence: float | None = None
    skipped: bool = False
    reason: str | None = None


# ---------------------------------------------------------------------------
# pure logic - no third-party imports, unit-tested with mocked Tesseract output
# ---------------------------------------------------------------------------


def mean_confidence(data: dict[str, Any]) -> float | None:
    """Mean word confidence from ``pytesseract.image_to_data``.

    Tesseract reports ``-1`` for layout boxes that contain no recognised word
    (blocks, paragraphs, lines). Averaging those in drags every page toward
    zero and would fail pages that read perfectly well, so they are excluded
    rather than treated as zero-confidence words.

    Returns ``None`` when the page yielded no words at all - which is a
    different condition from "low confidence" and is reported differently.
    """
    raw: Sequence[Any] = data.get("conf") or []
    scores: list[float] = []
    for value in raw:
        try:
            score = float(value)
        except (TypeError, ValueError):
            continue
        if score >= 0:
            scores.append(score)
    if not scores:
        return None
    return sum(scores) / len(scores)


def text_from_data(data: dict[str, Any]) -> str:
    """Rebuild page text from ``image_to_data`` output.

    Exists so one Tesseract pass serves both the text and the confidence that
    gates it. Line structure is reconstructed from the block/paragraph/line
    numbers rather than joining every word with spaces, because the chunker
    detects verse markers by looking at the *start of a line* - flattening the
    page to one long line would make every structural boundary invisible and
    silently push the whole document onto the sliding-window fallback.
    """
    words: Sequence[Any] = data.get("text") or []
    if not words:
        return ""

    confidences: Sequence[Any] = data.get("conf") or []
    blocks = data.get("block_num") or []
    paragraphs = data.get("par_num") or []
    lines = data.get("line_num") or []

    out: list[str] = []
    current: list[str] = []
    previous_key: tuple | None = None

    for index, raw in enumerate(words):
        word = (str(raw) if raw is not None else "").strip()

        # Tesseract emits an entry per layout box; only level-5 rows carry a
        # word, and those are the ones with a non-negative confidence.
        try:
            confident = float(confidences[index]) >= 0
        except (IndexError, TypeError, ValueError):
            confident = bool(word)
        if not word or not confident:
            continue

        key = (
            blocks[index] if index < len(blocks) else 0,
            paragraphs[index] if index < len(paragraphs) else 0,
            lines[index] if index < len(lines) else 0,
        )
        if previous_key is not None and key != previous_key:
            if current:
                out.append(" ".join(current))
            current = []
            # A new block or paragraph is a stronger break than a new line.
            if previous_key[:2] != key[:2]:
                out.append("")
        previous_key = key
        current.append(word)

    if current:
        out.append(" ".join(current))
    return "\n".join(out).strip()


TAMIL_BLOCK = ("஀", "௿")

# Below this share of Tamil letters, a page that was supposed to be Tamil is not
# carrying Tamil - it is carrying something that only looks like Tamil once a
# particular font renders it.
DEFAULT_MIN_TAMIL_RATIO = 0.30

# Fewer letters than this and the ratio is noise: a page of numbers, a plate
# caption, a bare heading. The count check alone decides those.
_MIN_LETTERS_TO_JUDGE = 20


def tamil_ratio(text: str | None) -> tuple[float, int]:
    """Share of alphabetic characters that are Tamil, and how many were counted.

    Digits and punctuation are excluded: a page of dosage tables is mostly
    numerals in any encoding, and counting them would drag the ratio toward zero
    for a page that is perfectly fine.
    """
    letters = [c for c in (text or "") if c.isalpha()]
    if not letters:
        return 0.0, 0
    tamil = sum(1 for c in letters if TAMIL_BLOCK[0] <= c <= TAMIL_BLOCK[1])
    return tamil / len(letters), len(letters)


def has_text_layer(
    text: str | None,
    min_chars: int,
    *,
    expect_tamil: bool = False,
    min_tamil_ratio: float = DEFAULT_MIN_TAMIL_RATIO,
) -> bool:
    """True when a page carries a *trustworthy* embedded text layer.

    Two independent conditions, because character count alone is not proof.

    **Enough characters.** The threshold is not zero: a scanned page routinely
    still yields a handful of extractable characters - a stamped page number, a
    watermark - and treating those as a text layer would return three characters
    for a full page of Tamil and call it success.

    **Actually Tamil, when Tamil is expected.** Legacy Tamil DTP fonts -
    SunAnand, Bamini, TSCII-family, TAU/Elango - are glyph-mapped through
    ``WinAnsiEncoding`` with no ``ToUnicode`` CMap. The page *displays* Tamil,
    but the codepoints stored are Latin: ``kUe;jhf;ftpay;`` is what
    ``மருந்தாக்கவியல்`` extracts to. That text is long, looks like text to any
    length check, and is meaningless - it would be embedded, indexed, retrieved
    and cited to a practitioner as though it were the book.

    Tesseract reads the *rendered glyphs*, so it produces correct Tamil Unicode
    regardless of how the PDF stores them. Routing these pages to OCR is
    therefore not a fallback, it is the only path that can work.

    ``expect_tamil`` is driven by the document's declared language rather than
    applied universally: an English textbook would legitimately score 0% and
    must not be forced through OCR for it.
    """
    if not text or len(text.strip()) < min_chars:
        return False
    if not expect_tamil:
        return True

    ratio, letters = tamil_ratio(text)
    if letters < _MIN_LETTERS_TO_JUDGE:
        # Too little alphabetic content to judge; the count check stands.
        return True
    return ratio >= min_tamil_ratio


def assess_ocr(
    page_no: int,
    text: str,
    confidence: float | None,
    min_confidence: float,
) -> PageResult:
    """Apply the confidence gate to one OCR'd page.

    Below the threshold the text is dropped from the index but the page is
    *recorded*: garbled OCR retrieved as a citation is worse than a gap, because
    the reader has no way to tell it is wrong. The record is what makes the gap
    visible.
    """
    if confidence is None:
        return PageResult(
            page_no=page_no,
            text="",
            source="ocr",
            confidence=None,
            skipped=True,
            reason="no text recognised - blank page or failed OCR",
        )

    if confidence < min_confidence:
        return PageResult(
            page_no=page_no,
            text="",
            source="ocr",
            confidence=confidence,
            skipped=True,
            reason=f"OCR confidence {confidence:.1f} below threshold {min_confidence:.1f}",
        )

    if not text.strip():
        # Confident about nothing: Tesseract found boxes it scored well but no
        # characters survived. Treat as a skip so it cannot pass as an empty page.
        return PageResult(
            page_no=page_no,
            text="",
            source="ocr",
            confidence=confidence,
            skipped=True,
            reason="OCR returned no usable characters",
        )

    return PageResult(page_no=page_no, text=text, source="ocr", confidence=confidence)


def summarise(results: Sequence[PageResult]) -> dict[str, Any]:
    """Per-document counts for logging and ``skipped_pages``."""
    skipped = [r for r in results if r.skipped]
    scored = [r.confidence for r in results if r.confidence is not None and not r.skipped]
    return {
        "pages": len(results),
        "text_layer": sum(1 for r in results if r.source == "text-layer" and not r.skipped),
        "ocr": sum(1 for r in results if r.source == "ocr" and not r.skipped),
        "skipped": len(skipped),
        "skipped_pages": [r.page_no for r in skipped],
        "mean_confidence": round(sum(scored) / len(scored), 1) if scored else None,
    }


# ---------------------------------------------------------------------------
# binaries
# ---------------------------------------------------------------------------


def configure_binaries(
    tesseract_cmd: str = "",
    poppler_path: str = "",
    tessdata_dir: str = "",
) -> str | None:
    """Point pytesseract at the binary and hand poppler's location back.

    All three default to what Docker provides - binaries on PATH and the
    language packs in the image's own tessdata. None of the Windows installers
    put themselves on PATH, hence the settings.

    ``tessdata_dir`` is exported as ``TESSDATA_PREFIX`` rather than passed as an
    argument because the value is read by ``tesseract.exe`` itself, from its
    environment, and pytesseract simply inherits this process's. It matters on
    Windows specifically: the language packs live under ``C:\\Program Files``,
    which an unelevated install cannot write to, so adding Tamil means pointing
    Tesseract at a directory the user owns.
    """
    if tesseract_cmd:
        import pytesseract

        pytesseract.pytesseract.tesseract_cmd = tesseract_cmd

    if tessdata_dir:
        resolved = str(Path(tessdata_dir).resolve())
        if os.environ.get("TESSDATA_PREFIX") != resolved:
            log.info("Using tessdata directory %s", resolved)
        os.environ["TESSDATA_PREFIX"] = resolved

    return poppler_path or None


def check_binaries(tesseract_cmd: str = "", poppler_path: str = "",
                   tessdata_dir: str = "") -> dict[str, Any]:
    """Report whether OCR can run, without raising.

    Called before a run starts so a missing binary becomes a clear FAILED status
    on the document rather than an exception thrown inside a background task.
    """
    status: dict[str, Any] = {"tesseract": None, "poppler": None, "ok": False}

    try:
        import pytesseract

        configure_binaries(tesseract_cmd, poppler_path, tessdata_dir)
        status["tesseract"] = str(pytesseract.get_tesseract_version())
        status["languages"] = sorted(pytesseract.get_languages(config=""))
    except Exception as exc:  # noqa: BLE001 - a probe reports, it does not raise
        status["tesseract_error"] = f"{type(exc).__name__}: {exc}"

    try:
        import pdf2image  # noqa: F401
    except Exception as exc:  # noqa: BLE001
        status["poppler_error"] = f"pdf2image not importable: {type(exc).__name__}: {exc}"
    else:
        # Importing pdf2image proves nothing about poppler - it is a wrapper that
        # shells out to pdftoppm. `pip install -r requirements.txt` alone would
        # pass an import check and then fail mid-ingestion with
        # PDFInfoNotInstalledError, so the binary itself is what gets probed.
        binary = shutil.which("pdftoppm", path=poppler_path or None)
        if binary:
            status["poppler"] = binary
        else:
            where = poppler_path or "PATH"
            status["poppler_error"] = f"pdftoppm not found on {where}"

    status["ok"] = status["tesseract"] is not None and status["poppler"] is not None
    return status


def require_binaries(tesseract_cmd: str = "", poppler_path: str = "",
                     tessdata_dir: str = "") -> dict[str, Any]:
    status = check_binaries(tesseract_cmd, poppler_path, tessdata_dir)
    if not status["ok"]:
        raise OcrUnavailableError(
            "OCR is unavailable: "
            + "; ".join(
                v for k, v in status.items() if k.endswith("_error") and isinstance(v, str)
            )
            + ". Install Tesseract 5 (with the 'tam' pack) and poppler, or set "
            "TESSERACT_CMD / POPPLER_PATH."
        )
    if "languages" in status and "tam" not in status["languages"]:
        # Not fatal - an English-only book still indexes - but a Tamil corpus
        # OCR'd with the English model produces confident nonsense.
        log.warning(
            "Tesseract has no 'tam' language pack (found: %s). Tamil pages will "
            "OCR badly and be scored as low confidence.",
            ", ".join(status["languages"][:12]),
        )
    return status


# ---------------------------------------------------------------------------
# image preprocessing
# ---------------------------------------------------------------------------


def _deskew(gray: Any) -> Any:
    """Rotate a page upright using the dominant text angle.

    Tesseract's line segmentation degrades quickly on skew, and old Siddha books
    are scanned by hand, so a degree or two is normal and five is not unusual.
    """
    import cv2
    import numpy as np

    inverted = cv2.bitwise_not(gray)
    _, mask = cv2.threshold(inverted, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    coords = cv2.findNonZero(mask)
    if coords is None:
        return gray

    angle = cv2.minAreaRect(coords)[-1]
    # minAreaRect reports [0, 90). Anything past 45 is the same skew measured
    # against the other edge of the rectangle.
    if angle > 45:
        angle -= 90

    if abs(angle) < 0.1 or abs(angle) > MAX_DESKEW_DEGREES:
        return gray

    height, width = gray.shape[:2]
    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), angle, 1.0)
    return cv2.warpAffine(
        gray,
        matrix,
        (width, height),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )


def preprocess(image: Any) -> Any:
    """Greyscale, denoise, deskew, binarise - in that order.

    Order is deliberate. Denoising before the skew estimate stops speckle from
    dragging the angle; binarising last means the threshold runs on pixels that
    have already been straightened, so it is not fighting interpolation blur
    along glyph edges.

    Adaptive thresholding rather than Otsu: a global threshold gives up on the
    darkened gutter of a tightly-bound old book and loses the inner column.
    """
    import cv2
    import numpy as np

    array = np.asarray(image)
    if array.ndim == 3:
        # PIL hands over RGB; OpenCV's constants assume BGR ordering.
        channels = array.shape[2]
        code = cv2.COLOR_RGBA2GRAY if channels == 4 else cv2.COLOR_RGB2GRAY
        gray = cv2.cvtColor(array, code)
    else:
        gray = array

    gray = cv2.medianBlur(gray, 3)
    gray = _deskew(gray)
    return cv2.adaptiveThreshold(
        gray,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        blockSize=31,
        C=15,
    )


# ---------------------------------------------------------------------------
# extraction
# ---------------------------------------------------------------------------


def extract_text_layer(pdf_path: Path) -> dict[int, str]:
    """Embedded text per 1-based page number. Empty dict if the file is unreadable."""
    from pypdf import PdfReader

    reader = PdfReader(str(pdf_path))
    layers: dict[int, str] = {}
    for index, page in enumerate(reader.pages, start=1):
        try:
            layers[index] = page.extract_text() or ""
        except Exception as exc:  # noqa: BLE001 - one bad page must not stop the book
            log.warning("page %s: text-layer extraction failed (%s)", index, exc)
            layers[index] = ""
    return layers


def page_count(pdf_path: Path) -> int:
    from pypdf import PdfReader

    return len(PdfReader(str(pdf_path)).pages)


def ocr_page(pdf_path: Path, page_no: int, languages: str, dpi: int, poppler_path: str | None) -> tuple[str, float | None]:
    """Rasterise and OCR exactly one page.

    One page at a time, deliberately. ``convert_from_path`` over a whole book at
    300 DPI holds every page in memory at once - roughly 25 MB each, so a
    400-page book needs about 10 GB before OCR has even started.
    """
    import pytesseract
    from pdf2image import convert_from_path
    from pytesseract import Output

    images = convert_from_path(
        str(pdf_path),
        dpi=dpi,
        first_page=page_no,
        last_page=page_no,
        poppler_path=poppler_path,
    )
    if not images:
        return "", None

    processed = preprocess(images[0])
    # --psm 1: automatic page segmentation with orientation detection, which
    # suits a book page carrying a header, a verse number and a body column.
    config = "--oem 1 --psm 1"

    # ONE Tesseract pass. image_to_data already returns every recognised word,
    # so calling image_to_string as well would OCR the page a second time -
    # roughly doubling ingestion, and with tessdata_best Tamil that is minutes
    # per page rather than seconds. Worse, the two passes are independent runs:
    # the text and the confidence score that gates it could describe different
    # output.
    data = pytesseract.image_to_data(
        processed, lang=languages, config=config, output_type=Output.DICT
    )
    return text_from_data(data), mean_confidence(data)


def extract_pages(
    pdf_path: Path,
    *,
    languages: str = "tam+eng",
    dpi: int = 300,
    min_confidence: float = 45.0,
    text_layer_min_chars: int = 120,
    poppler_path: str | None = None,
    progress_every: int = 25,
    expect_tamil: bool = False,
    min_tamil_ratio: float = DEFAULT_MIN_TAMIL_RATIO,
) -> Iterator[PageResult]:
    """Yield one :class:`PageResult` per page, in order.

    A generator rather than a list so a 400-page book is chunked and embedded
    incrementally instead of being held in memory whole.
    """
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    layers = extract_text_layer(pdf_path)
    total = len(layers)
    log.info("%s: %s pages", pdf_path.name, total)

    for page_no in range(1, total + 1):
        if progress_every and page_no % progress_every == 0:
            log.info("%s: page %s/%s", pdf_path.name, page_no, total)

        embedded = layers.get(page_no, "")
        if has_text_layer(embedded, text_layer_min_chars,
                          expect_tamil=expect_tamil, min_tamil_ratio=min_tamil_ratio):
            yield PageResult(page_no=page_no, text=embedded, source="text-layer")
            continue

        # Long enough to look like text but not actually Tamil: a legacy
        # glyph-mapped font. Worth naming in the log, because the page will now
        # cost an OCR pass and the reason is not obvious from the page itself.
        if expect_tamil and embedded and len(embedded.strip()) >= text_layer_min_chars:
            ratio, letters = tamil_ratio(embedded)
            log.info(
                "page %s: text layer has %s chars but only %.0f%% Tamil letters "
                "(%s letters) - treating as untrustworthy and sending to OCR",
                page_no, len(embedded.strip()), ratio * 100, letters,
            )

        try:
            text, confidence = ocr_page(pdf_path, page_no, languages, dpi, poppler_path)
        except Exception as exc:  # noqa: BLE001
            # One unreadable page must not abandon the other 399, but it is
            # recorded rather than passed over.
            log.warning("page %s: OCR failed (%s: %s)", page_no, type(exc).__name__, exc)
            yield PageResult(
                page_no=page_no,
                text="",
                source="ocr",
                skipped=True,
                reason=f"OCR error: {type(exc).__name__}: {exc}",
            )
            continue

        result = assess_ocr(page_no, text, confidence, min_confidence)
        if result.skipped:
            log.warning("page %s skipped: %s", page_no, result.reason)
        yield result
