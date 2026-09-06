# Inline math and scientific formatting

This is the historical inline pass. Subsequent repairs and current test results
are in [EDGE_CASE_REPORT.md](EDGE_CASE_REPORT.md). Counts below describe the earlier pass.

The local parser now preserves native inline formatting in eligible paragraphs.
The user's Mathematical Formalisms section (pages 4-5) passes the new independent
13-block presentation audit. The full paper still passes its 137-block,
19-section structural audit. These are bounded checks, not full OCR or mathematical
transcription approval.

Open the [updated PDF/Markdown comparison](outputs/formulas-cached/camera-ready/review.html),
[Markdown](outputs/formulas-cached/camera-ready/paper.md), or
[inline audit](outputs/formulas-cached/camera-ready/inline-audit.json).

## Changes in the user's paper

- Token and hidden-state sequences retain their subscripts. The reviewed section
  contains 13 HTML-rendered subscripts, including `liwc`, `bilstm`, and `combined`.
- Run-in labels such as **Text Representation (DistilBERT)**, **Sequential Pattern
  Analysis (BiLSTM)**, **Feature Fusion**, and **Final Classification** retain their
  bold/italic formatting. They remain part of their original paragraphs.
- Variable emphasis, the Sigmoid function label, and the loss-function name retain
  their source formatting.
- Two inline expressions use original PDF crops: the hidden-state membership and
  dimension expression, and the concatenation expression with two vector arrows.
  The first retains its superscript and mathematical glyph appearance; the second
  retains both drawn arrows. Their text alternatives remain explicitly unverified.
- All seven display equations continue to use original source crops. Existing
  candidate LaTeX is still unverified.

The paper has 18 enriched paragraphs in total, including five outside the audited
mathematical prose. The independent expectations are in `camera-ready-inline.json`;
the parser never reads that file and contains no paper-specific formula strings.

## How it works

`inline.py` reads native character boxes, font flags, sizes and baselines through
PyMuPDF. It accepts single-location text paragraphs only when native and Docling
characters agree after Unicode normalization and whitespace removal. It preserves
the existing plain text and section ownership in the structured document.

Eligible content gains HTML emphasis, subscripts and superscripts in `paper.md`.
Drawn marks, mathematical font glyphs, or ambiguous small text use source crops.
Their PDF page, crop rectangle, native runs, reasons and text alternatives are
recorded in `inline-content.json`. Corresponding blocks in `structure.json` link
to that representation. Markdown consumers need inline HTML and the local assets.

Visual review caught two problems during development: crop padding included small
fragments of neighboring text, and AlexNet's overlapping native extraction lines
could duplicate mathematical glyphs across separate crops. Final crops use tight
bounds; overlapping extraction lines are skipped and recorded for later repair.
Markdown punctuation and HTML in source text are escaped so they cannot change
the rendered content or inject markup.

## Verification

- 29 tests pass, including deliberately damaged inline output, script geometry,
  arrowhead bounds, source-pixel matching, content escaping, and corpus checks.
- The 13 source-reviewed mathematical prose blocks pass on both the existing
  formula-enriched run and a fresh parse of the user's original PDF path.
- The fresh CPU parse succeeded with formula recognition off; its recorded
  parse/export duration was 43.39 seconds. Review regeneration followed the final
  overlap guard. This is not an Azure benchmark or a complete end-to-end timer.
- All 12 final corpus outputs (99 pages) were regenerated from their immutable
  extraction runs. The 160 selected heading anchors still pass; section graphs
  and plain block text are unchanged apart from added inline-representation links.
- Every enriched block was checked through actual CommonMark rendering for
  normalized character preservation, including recorded crop text alternatives.
  This does not validate symbols absent from both text extractors.
- All final browser checks report no JavaScript errors, broken images, or broken
  outline links. Inline images load with nonzero dimensions. Visual checks focused
  on all 13 user-paper math paragraphs and selected examples from other papers.
  They are not an exhaustive visual audit of all 99 pages.

| Case | Enriched text blocks | Inline source crops |
|---|---:|---:|
| AlexNet | 8 | 27 |
| Attention | 17 | 57 |
| BERT | 5 | 5 |
| User paper | 18 | 2 |
| User paper, mixed native/scanned | 6 | 0 |
| User paper, scanned | 0 | 0 |
| MobileNetV2 | 5 | 21 |
| ResNet | 8 | 15 |
| Scikit-learn | 11 | 4 |
| Scikit-learn, scanned | 0 | 0 |
| Structure fixture | 0 | 0 |
| U-Net | 2 | 13 |
| **Total** | **80** | **144** |

These counts describe applied presentation changes, not recall or accuracy.
Before snapshots are in `outputs/inline-before/`; the fresh run is in
`outputs/inline-smoke/camera-ready/`. The main comparison retains the earlier
formula-recognition candidates to keep those experiments reviewable.

## Remaining work

Scanned PDFs provide no native formatting evidence and retain their previous OCR
output. Paragraphs with text mismatches, multiple source locations, or overlapping
native lines also retain their existing export; each skip has a recorded reason.
This includes known scientific-formatting losses in AlexNet and other papers.
Formatting in headings, lists, captions and table cells is outside this pass.

The next local fidelity work is physical-line reconstruction for skipped math,
scanned mathematical text, and source-checked table cells. Renderable, accessible
LaTeX/MathML still needs separate validation. The app, database, Azure hosting and
production have not been integrated with this experimental representation.

Reproduce the user-paper checks:

```sh
cd docling-lab
.venv/bin/python review.py outputs/formulas-cached/camera-ready
.venv/bin/python audit_inline.py outputs/formulas-cached/camera-ready
.venv/bin/python audit_structure.py outputs/formulas-cached/camera-ready
.venv/bin/python -m pytest -q
node render_reviews.mjs formulas-cached
```
