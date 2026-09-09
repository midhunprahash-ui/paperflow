# Docling research-paper laboratory

Standalone local evaluation, separate from Rpaper, Supabase, OpenRouter and Azure.
Only Docling performs document recognition. There is no rewriting/summarization LLM.
The pipeline is now available in the experimental local app with explicit source
image fallbacks; see [integration verification](APP_INTEGRATION.md). Production
release still requires local reader evaluation and resolution of the relevant
fidelity and hosting limits.

Start with [the latest edge-case results](EDGE_CASE_REPORT.md), [the results index](index.html), [inline math and formatting](INLINE_REPORT.md),
and [the complete structure audit update](STRUCTURE_REPORT.md).
Twelve corpus cases (99 pages), plus three one-page rotation checks, have been processed locally; limitations are explicit.
The [initial evaluation report](REPORT.md) records the original ten-case experiment.

## Run

Use Python 3.12. The environment for this checkout is `.venv`.

```sh
cd docling-lab
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python fetch_corpus.py --include-additional
.venv/bin/python make_variants.py
.venv/bin/python parse_pdf.py inputs/camera-ready.pdf --output outputs/my-run/camera-ready
```

The script rejects PDFs above 16 pages before loading models. Default: CPU, two
threads, accurate table recognition, native text plus selective OCR, heading
hierarchy enabled, local image extraction. First use downloads model weights.
No inference API credentials are needed. Original PDFs are never modified.
Empty, corrupt, non-PDF and encrypted inputs are rejected. PDF rotation metadata
is normalized in a separate copy. Partial conversions and missing output pages
are failures. Upright OCR defaults to line rotation classification disabled;
`--ocr-line-rotation` enables that classifier for a separate experiment.

Formula recognition is an explicit experiment:

```sh
.venv/bin/python parse_pdf.py inputs/camera-ready.pdf --output outputs/formulas/camera-ready --formulas
.venv/bin/python run_suite.py --run baseline
.venv/bin/python evaluate.py baseline
.venv/bin/python -m pytest -q
```

For a full formula comparison, use `run_suite.py --run my-formula-run --formulas`,
then `evaluate.py my-formula-run`. Formula candidates are **unverified**: the
Docling comparison exports retain source equation images in both modes. Azure
exports additionally retain LaTeX candidates for server-side KaTeX rendering,
with source comparison and image fallbacks. Rendering does not verify the OCR.
Inline formatting now uses
native font/baseline evidence in eligible paragraphs, with source crops for drawn
marks and uncertain glyphs. Split native math lines are reconstructed using their
baselines; embedded Type1 glyph bounds keep source crops clear of adjacent text.
Scanned paragraphs use source images while retaining unverified OCR in JSON.
Other skipped blocks remain limitations; see `inline-content.json`. The CPU formula setup
explicitly enables the generation cache.
ONNX Runtime telemetry is disabled before inference to avoid an observed macOS
shutdown crash; model downloads still require internet on first use.

`--device mps` is available for a separate Mac experiment; CPU results are the
relevant initial check for future CPU hosting. Mac timings are not Azure timings.
The suite runs serially in fresh processes and records timeouts/errors in `logs/`.
Use a new run name for a changed parser; completed raw outputs are not overwritten.

## Outputs per PDF

- `baseline.md`: untouched Docling Markdown export.
- `raw.json`: untouched structured Docling document, including provenance.
- `paper.md`: corrected export requiring review, with traceable corrections/fallbacks.
- `document.json`: corresponding document representation (fallback details in quality report).
- `structure.json`: explicit section tree, block owners, lists, captions and source locations.
- `inline-content.json`: native inline runs, scripts, emphasis, crop bounds and skipped-block reasons; referenced from `structure.json`.
- `ocr-lines.json`: original OCR lines, confidence and page bounds (new runs).
- `source-fragments.json`: scanned paragraph image bounds, hashes and unverified OCR alternatives.
- `table-content.json`: cell occupancy diagnostics and source-backed ruled-table repairs, including merged cells and images per cell.
- `review.html`: original rendered pages alongside the actual Markdown output.
- `assets/`: source pages and equation crops; referenced image folders retain figures.
- `blocks.json`: reading-order labels, heading levels and page bounds.
- `quality.json`: correction log, warnings, heading outline, text-coverage diagnostic.
- `evaluation.json`: comparison against selected source-reviewed anchors.
- `run.json`: versions, configuration, elapsed time and peak process memory.
- `formula-candidates.json`: candidate math text plus source images, all unverified.

To rebuild corrected exports after editing normalization, without repeating model
inference: `.venv/bin/python review.py outputs/my-run/camera-ready`.
`baseline.md` and `raw.json` are kept unchanged. The lab's `summarize_results.py`
collects the recorded evaluation runs into the index and measurement table.
Native punctuation restoration is permitted only when letters and digits agree;
its before/after evidence is recorded in `quality.json`.

The complete audit for the exact user-supplied PDF is:

```sh
.venv/bin/python audit_structure.py outputs/formulas-cached/camera-ready
.venv/bin/python audit_inline.py outputs/formulas-cached/camera-ready
.venv/bin/python audit_structure.py outputs/ocr-ordered/camera-ready-scan
.venv/bin/python audit_structure.py outputs/ocr-ordered/camera-ready-mixed
.venv/bin/python audit_numeric_cells.py
```

`camera-ready-structure.tsv` is the manually source-reviewed expectation file.
The parser never reads it. The audit checks all 137 annotated blocks and 19
sections, then saves `STRUCTURE_AUDIT.md`, `structure-audit.json`, and
`content-diagnostics.json`. This is separate from the selected-anchor corpus
checks. It does not certify mathematical transcription or OCR accuracy.
Registered synthetic variants use the same independent source inventory, with
the scanned input and its OCR evidence used to reconstruct the actual hierarchy.
Tests requiring corpus artifacts must not be skipped when accepting a local run.

`camera-ready-inline.json` independently records source-reviewed formatting for
the 13 prose blocks in Mathematical Formalisms on pages 4-5. Its audit checks
subscripts, emphasis, recorded source-crop alternatives and the actual Markdown.
Markdown consumers must support inline HTML (`sub`, `sup`, `strong`, `em`, `img`)
and keep the image assets beside `paper.md` to preserve this presentation.

Optional browser verification uses the parent app's Playwright installation:
`node render_reviews.mjs formulas-cached`. Browser screenshots and diagnostics
are written inside each output directory.

Open `review.html` locally. If the browser restricts local assets, run
`.venv/bin/python -m http.server 8001 --bind 127.0.0.1` from this folder.
The review page uses bundled local KaTeX when available in the parent app; it
does not send paper content to any service.

## Corpus and interpretation

`corpus.json` records public source URLs and the user-supplied paper. Downloaded
inputs, generated outputs, logs and environments are ignored by Git. The downloaded
PDFs retain their original rights; this folder does not publish or redistribute them.
`inputs/sources.json` records SHA-256 hashes. Synthetic scan/mixed PDFs are clearly
labelled in `inputs/variants.json` and are not substitutes for physical scanner tests.

`expectations.json` contains manually selected anchors from the source PDFs. It is
not an exhaustive transcription. Word coverage is a bag-of-words diagnostic; it
cannot prove reading order, equation correctness or hierarchy fidelity. Scanned
variants must also be compared with their digital originals. Successful execution
is never recorded as automatic fidelity approval.

Do not describe an image fallback as extracted LaTeX or structured table data.
Markdown requires accompanying images and can require HTML for merged table cells.
Keep the raw JSON for any future application integration.
