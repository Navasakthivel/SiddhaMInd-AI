"""Generate corpus/test-sample.pdf - a synthetic 4-page smoke-test fixture.

Each page exercises one branch of the ingestion pipeline:

    1  English, native PDF text          -> text-layer path, structural chunking
    2  Tamil, image + invisible text     -> text-layer path, verse-boundary detection
    3  Mixed prose, image + invisible    -> sliding-window fallback
    4  Image ONLY, no text layer         -> OCR path via Tesseract

Why pages 2-4 are rendered images
---------------------------------
Neither reportlab nor Pillow-on-Windows performs complex-script shaping, and
Tamil needs it: ``நிலவேம்பு`` renders as ``நிலவமேபு`` because the vowel sign ே
must be reordered to sit *before* the consonant it follows logically, and
consonant+ு ligatures are not formed at all. Windows' own GDI+ text stack does
shape correctly, so the page images come from there via PowerShell.

Pages 2 and 3 then get an *invisible* text layer (render mode 3) carrying the
correct codepoints. That is exactly how a real digitised book is built, and it
means the fixture both looks right when opened and extracts right when parsed.

Page 4 deliberately gets no text layer, so ``has_text_layer`` fails and the page
must go through Tesseract.

Windows-only: it shells out to PowerShell for GDI+ rendering. Regenerating the
fixture on Linux would need a shaping engine (libraqm, or HarfBuzz via
uharfbuzz). The committed PDF itself is portable.

    python scripts/make_test_pdf.py
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
OUT_PDF = REPO / "corpus" / "test-sample.pdf"

DPI = 300
PAGE_W_PT, PAGE_H_PT = 595.27, 841.89          # A4 in points
PAGE_W_PX = int(PAGE_W_PT / 72 * DPI)          # 2480
PAGE_H_PX = int(PAGE_H_PT / 72 * DPI)          # 3508

TAMIL_FONT = r"C:\Windows\Fonts\Nirmala.ttc"

# ---------------------------------------------------------------------------
# page content
# ---------------------------------------------------------------------------

# Three numbered entries. The chunker should split on 101./102./103. and keep
# each formulation whole - method, dose and anupanam travelling with the name.
PAGE1 = """SIDDHA FORMULARY OF INDIA - SYNTHETIC TEST DOCUMENT
Part 1: Churna (Chooranam) Preparations

101. Thiripala Chooranam
SFI Code SFI-T1-101
Ingredients: Kadukkai 35 g, Thandrikkai 35 g, Nellikkai 35 g
Preparation: Dry each fruit separately in shade, remove the seeds, powder
them individually and sieve through a fine cloth before mixing.
Dose: 2 to 4 g twice daily
Anupanam: Warm water
Indications: Constipation, poor digestion, eye disorders
Shelf life: 6 months

102. Sukku Chooranam
SFI Code SFI-T1-102
Ingredients: Dried ginger rhizome 100 g
Preparation: Powder the dried rhizome and sieve through a fine cloth.
Dose: 1 to 2 g twice daily
Anupanam: Honey
Indications: Vatham disorders, indigestion, loss of appetite
Shelf life: 12 months

103. Amukkara Chooranam
SFI Code SFI-T1-103
Ingredients: Amukkara root 100 g, Palm sugar 50 g
Preparation: Powder the dried root, mix with palm sugar and sieve well.
Dose: 2 g at night
Anupanam: Cow milk
Indications: General debility, insomnia, nervous weakness
Shelf life: 6 months"""

# Two Arabic-numeral markers plus one Tamil numeral (௪௪ = 44), so the Tamil
# numeral branch of the boundary detector is exercised too.
PAGE2 = """சித்த மருத்துவம் - தமிழ்ப் பகுதி

42. நிலவேம்பு குடிநீர்
சேர்க்கும் பொருட்கள்: நிலவேம்பு, வெட்டிவேர், சந்தனம்
செய்முறை: மூன்றையும் இடித்து கஷாயம் வைக்கவும்
அளவு: 30 மில்லி இருவேளை
அனுபானம்: தேன்
தீரும் நோய்கள்: சுரம், வாதம், பித்தம்

43. திரிகடுகு சூரணம்
சேர்க்கும் பொருட்கள்: சுக்கு, மிளகு, திப்பிலி சம அளவு
செய்முறை: தனித்தனியே இடித்து சலித்து கலக்கவும்
அளவு: 1 முதல் 2 கிராம்
அனுபானம்: தேன்
பத்தியம்: புளி, மீன் தவிர்க்கவும்

௪௪. அமுக்கரா சூரணம்
சேர்க்கும் பொருட்கள்: அமுக்கரா வேர் 100 கிராம்
செய்முறை: வேரை உலர்த்திப் பொடித்து சலிக்கவும்
அளவு: 2 கிராம் இரவில்
அனுபானம்: பசும்பால்"""

# Deliberately structureless: no numbered lines, and no line ending in a
# dosage-form word, so nothing can be mistaken for a heading. Long enough to
# force more than one sliding window at CHUNK_SIZE=900.
PAGE3 = """Principles of Siddha Practice / சித்த மருத்துவக் கோட்பாடுகள்

The Siddha system understands the body as a composite of five elements and
three humours. வாதம், பித்தம், கபம் ஆகிய மூன்றும் சமநிலையில் இருக்கும்போது உடல்
நலமாக இருக்கும். When one humour rises or falls beyond its natural proportion,
disease follows, and the practitioner's task is to identify which humour has
moved and in which direction before anything at all is prescribed.

நோயின் தன்மையை அறிய எண்வகைத் தேர்வு பயன்படுத்தப்படுகிறது. இது நாடி, ஸ்பரிசம், நா,
நிறம், மொழி, விழி, மலம், மூத்திரம் ஆகிய எட்டு வழிகளில் நோயாளியை ஆராய்கிறது. Among
these the pulse reading carries the greatest weight, since it reports the
humoural balance directly rather than through a secondary sign that may have
several unrelated causes.

Treatment proceeds from the least invasive intervention outward. உணவே மருந்து
என்பது சித்த மருத்துவத்தின் அடிப்படைக் கோட்பாடு. Dietary correction and daily
regimen are attempted first; internal preparations follow only when the
imbalance does not yield to them. மருந்து கொடுக்கும் முன் உடலைச் சுத்தம் செய்வது
அவசியம் என்று பழைய நூல்கள் வலியுறுத்துகின்றன.

The classical texts insist that any preparation containing a metal or a mineral
must undergo purification before it is administered, and that the practitioner
must record the patient's constitution before prescribing anything at all.
இந்த நடைமுறைகள் பாரம்பரியமாக ஆசிரியரிடமிருந்து மாணவருக்குக் கடத்தப்பட்டன, and
much of that transmission was never written down in the first place."""

# The marker line is what proves a chunk came through Tesseract: this string
# exists nowhere in any text layer in the document.
PAGE4 = """SCANNED PAGE - NO TEXT LAYER

104. Nilavembu Kudineer
Ingredients: Nilavembu 10 g, Vettiver 5 g, Santhanam 5 g
Preparation: Coarsely powder the drugs and boil in 240 ml of water,
reduce to 60 ml and filter through a clean cloth.
Dose: 30 to 60 ml twice daily
Anupanam: Warm water
Indications: Fever, body pain, thirst

105. Pavala Parpam
Ingredients: Purified coral 20 g
Preparation: Grind with rose water and subject to a mild puttam.
Dose: 100 mg twice daily
Anupanam: Honey
Indications: Acidity, burning sensation, general weakness

நிலவேம்பு குடிநீர் - சுரம் தீர்க்கும் மருந்து
அளவு: 30 மில்லி  அனுபானம்: தேன்"""


# ---------------------------------------------------------------------------
# GDI+ rendering via PowerShell
# ---------------------------------------------------------------------------

RENDER_PS1 = r"""
param([string]$TextFile, [string]$OutPng, [int]$Width, [int]$Height, [int]$FontSize)
Add-Type -AssemblyName System.Drawing
$text  = Get-Content -Path $TextFile -Encoding UTF8 -Raw
$bmp   = New-Object System.Drawing.Bitmap $Width, $Height
$g     = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)
# ClearType subpixel AA would put colour fringes on glyph edges, which survives
# the greyscale conversion as noise. Grid-fit greyscale is what a scan looks like.
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$font  = New-Object System.Drawing.Font("Nirmala UI", $FontSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$brush = [System.Drawing.Brushes]::Black
$margin = [int]($Width * 0.09)
$y = $margin
foreach ($line in ($text -split "`r?`n")) {
    $g.DrawString($line, $font, $brush, $margin, $y)
    $y += [int]($FontSize * 1.55)
}
$bmp.Save($OutPng, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "rendered $OutPng"
"""


def render_page(text: str, out_png: Path, font_size: int = 52) -> None:
    """Rasterise one page through GDI+, which shapes Tamil correctly."""
    with tempfile.NamedTemporaryFile(
        "w", suffix=".txt", delete=False, encoding="utf-8-sig"
    ) as handle:
        handle.write(text)
        text_file = handle.name

    script = Path(tempfile.gettempdir()) / "_render_page.ps1"
    script.write_text(RENDER_PS1, encoding="utf-8")

    result = subprocess.run(
        [
            "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
            "-File", str(script),
            "-TextFile", text_file,
            "-OutPng", str(out_png),
            "-Width", str(PAGE_W_PX),
            "-Height", str(PAGE_H_PX),
            "-FontSize", str(font_size),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 or not out_png.exists():
        raise RuntimeError(f"GDI+ render failed:\n{result.stdout}\n{result.stderr}")
    Path(text_file).unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# PDF assembly
# ---------------------------------------------------------------------------


def build() -> Path:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfgen import canvas

    pdfmetrics.registerFont(TTFont("Nirmala", TAMIL_FONT, subfontIndex=0))

    workdir = Path(tempfile.mkdtemp(prefix="siddha-fixture-"))
    OUT_PDF.parent.mkdir(parents=True, exist_ok=True)

    print("Rendering page images through GDI+ ...")
    images = {}
    for page, text in ((2, PAGE2), (3, PAGE3), (4, PAGE4)):
        png = workdir / f"page{page}.png"
        render_page(text, png, font_size=46 if page == 3 else 52)
        images[page] = png
        print(f"  page {page}: {png.name} ({png.stat().st_size // 1024} KB)")

    pdf = canvas.Canvas(str(OUT_PDF), pagesize=A4)
    pdf.setTitle("Synthetic Test Document")
    pdf.setAuthor("SiddhaMind AI test fixture")

    # --- page 1: real PDF text, no image ---------------------------------
    pdf.setFont("Helvetica", 11)
    y = PAGE_H_PT - 70
    for line in PAGE1.split("\n"):
        pdf.drawString(58, y, line)
        y -= 15.5
    pdf.showPage()

    # --- pages 2 and 3: image + invisible text ---------------------------
    for page in (2, 3):
        pdf.drawImage(
            str(images[page]), 0, 0, width=PAGE_W_PT, height=PAGE_H_PT,
            preserveAspectRatio=False,
        )
        text_object = pdf.beginText(58, PAGE_H_PT - 70)
        text_object.setFont("Nirmala", 11)
        # Mode 3 = neither fill nor stroke: the characters are present for
        # extraction and search but never drawn, so they cannot double up with
        # the rendered image underneath.
        text_object.setTextRenderMode(3)
        for line in (PAGE2 if page == 2 else PAGE3).split("\n"):
            text_object.textLine(line)
        pdf.drawText(text_object)
        pdf.showPage()

    # --- page 4: image only, deliberately no text object ------------------
    pdf.drawImage(
        str(images[4]), 0, 0, width=PAGE_W_PT, height=PAGE_H_PT,
        preserveAspectRatio=False,
    )
    pdf.showPage()

    pdf.save()
    return OUT_PDF


def verify(path: Path) -> int:
    """Confirm each page has - or lacks - a text layer as intended."""
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    print(f"\nVerifying {path.name}: {len(reader.pages)} pages, "
          f"{path.stat().st_size // 1024} KB")

    expectations = {1: True, 2: True, 3: True, 4: False}
    failures = 0

    for index, page in enumerate(reader.pages, start=1):
        extracted = (page.extract_text() or "").strip()
        has_layer = len(extracted) >= 120
        expected = expectations[index]
        ok = has_layer == expected
        failures += 0 if ok else 1
        tamil = sum(1 for c in extracted if "\u0b80" <= c <= "\u0bff")
        print(
            f"  page {index}: {len(extracted):5d} chars extracted "
            f"({tamil:4d} Tamil)  text-layer={has_layer!s:5}  "
            f"expected={expected!s:5}  {'ok' if ok else 'MISMATCH'}"
        )

    if failures:
        print(f"\n  {failures} page(s) did not match expectations")
    else:
        print("\n  All pages behave as intended. Page 4 will go through OCR.")
    return failures


if __name__ == "__main__":
    out = build()
    sys.exit(1 if verify(out) else 0)
