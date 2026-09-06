# Local parser repairs and edge-case validation

Update: the experimental local app now uses this pipeline with explicit source
image fallbacks. See [the integration report](APP_INTEGRATION.md) for the newer
checks and remaining limits. The results below record the earlier laboratory gate.

All **46 defined automated tests pass**, with no failures or skips. This is a
local laboratory result, not certification that arbitrary papers preserve every
character or mathematical expression. The application integration gate remains
open pending the fidelity limitations below.

Open [the comparison index](index.html) for every corpus PDF and its Markdown.
For the supplied paper, compare the [native output](outputs/formulas-cached/camera-ready/review.html),
[scanned output](outputs/ocr-ordered/camera-ready-scan/review.html), and
[mixed output](outputs/ocr-ordered/camera-ready-mixed/review.html).

## Verified results

| Check | Result | Scope |
|---|---|---|
| Automated regression and edge cases | 46 passed, 0 failed, 0 skipped | [JUnit results](outputs/final-tests.xml) |
| Corpus conversions | 12 cases, 99 pages | Eight research papers, three synthetic scan/mixed variants, one structural fixture |
| Additional rotation conversions | 3 cases, 3 pages | The supplied paper's math page at PDF metadata rotations 0, 90 and 180 degrees |
| Selected hierarchy anchors | 160 passed | Heading levels/order and selected figure/table/page counts |
| Complete annotated structure of supplied paper | 137 blocks, 19 sections; pass in all three versions | Presence, type, section ownership, reading order, references and numbered equations |
| Native math prose audit | 13 blocks passed | Source-reviewed Mathematical Formalisms paragraphs on pages 4–5 |
| Native numeric table cells | 555 matched source coordinates | Existing numeric cells with suitable bounds; not a missing-cell or general table accuracy score |
| Scanned results table | All 42 numeric cells matched | Compared with the independently checked native table |
| Browser checks | All 15 current outputs passed | No page errors, broken reader images or broken section links |
| Artifact checks | No missing assets, unmatched exports or stale normalization hashes | The 12 selected corpus outputs |
| Environment | Dependency check passed | Five third-party SWIG deprecation warnings during tests |

The rotation cases are narrow derivatives, not three additional independent
research papers. Synthetic scans use 180 DPI for the supplied paper and 120 DPI
for Scikit-learn. They do not establish performance on physical scanner output.

## Repairs

1. **Native inline math:** reconstructed split extraction lines by their physical
   baselines, rejected a spurious superscript flag on full-size prose, and used
   embedded Type1 glyph outlines to bound difficult symbols. The three previously
   skipped AlexNet/Attention paragraphs now retain their text and source-backed
   math. Square-root crops no longer include characters from the previous line.
2. **Scanned reading order:** disabled the OCR line-rotation classifier by default
   after it inverted an upright sentence. Persisted OCR lines and their bounds;
   reordered lines only when their character inventories agree. Reattached
   detached reference markers, cross-column reference continuations, and list
   markers using source geometry. Equation labels retain their OCR evidence.
3. **Scanned math appearance:** retained source paragraph images alongside
   unverified OCR text. There are 133 paragraph fallbacks across the scan/mixed
   corpus. The sampled math crops match independent source renders within a
   maximum one-level, mean-below-0.01 8-bit interpolation tolerance; file hashes
   are checked exactly.
4. **Tables:** recovered the ResNet architecture table from drawn rules into
   9 rows, 7 columns and 48 structured cells, including merged cells. Each repaired
   cell preserves its original pixels for matrices and superscripts. Paired
   horizontal rules no longer create fake empty AlexNet rows. Cell occupancy
   diagnostics report invalid spans, overlaps and unassigned slots separately.
5. **Native punctuation:** restored visible punctuation only when all letters and
   digits agree with native source evidence. Before/after changes are recorded;
   immutable raw extraction is retained.
6. **Input failures:** rejected empty, corrupt, non-PDF, blank, encrypted and
   over-16-page inputs before model loading. Partial conversion, missing output
   pages and empty content cannot report successful conversion. Rotation
   normalization uses a separate copy and refuses to overwrite one.

The 12 current outputs contain 226 paragraphs with native inline presentation
and 384 inline source crops. Visual checks covered the repaired AlexNet/Attention
math, the ResNet table, native and scanned math in the supplied paper, its scanned
results table, and the low-resolution Scikit-learn scan. Browser automation
checked every output; it does not substitute for visual inspection of every block.

## Remaining fidelity limits

- Formula candidates are still **unverified LaTeX**. Source images preserve
  appearance but do not provide fully editable, accessible semantic math.
- Scanned paragraph images retain their original line wrapping. OCR alternatives,
  scanned headings and lists are not fully character-verified. Source images need
  to remain alongside Markdown, whose consumer must support the emitted HTML.
- Native inline reconstruction does not cover every heading, list, footnote,
  multi-location paragraph or skipped block. For example, mathematical footnote
  formatting in Attention still needs a separate source-backed treatment.
- There are **206 unassigned grid slots across 14 tables**. Many are expected
  blanks, including Attention's table of unchanged experimental parameters; all
  have zero detected overlaps or invalid spans. Their blank-versus-omission
  meaning and all nonnumeric cell transcription have not been exhaustively
  source-reviewed. They are not silently filled or declared accurate.
- Only the supplied paper and its registered variants have a complete annotated
  block inventory. Other papers have selected anchors and targeted checks. The
  corpus has been used during development and is not an independent benchmark.
- Rotated raster content, skew, physical scan degradation, handwriting and
  multilingual papers have not been tested by this suite. Metadata rotation
  normalization is a narrower capability.

The confirmed regressions are fixed and the defined suite is green. A claim that
all possible PDF edge cases pass, or that full semantic fidelity is solved, would
go beyond this evidence. App integration and hosting still require a decision on
these remaining presentation and semantic limits.

## Recheck

```sh
cd docling-lab
.venv/bin/python -m pytest -q --junitxml=outputs/final-tests.xml
.venv/bin/python audit_structure.py outputs/formulas-cached/camera-ready
.venv/bin/python audit_structure.py outputs/ocr-ordered/camera-ready-scan
.venv/bin/python audit_structure.py outputs/ocr-ordered/camera-ready-mixed
.venv/bin/python audit_inline.py outputs/formulas-cached/camera-ready
.venv/bin/python audit_numeric_cells.py
.venv/bin/python evaluate.py formulas-cached
.venv/bin/python evaluate.py heldout-structure
.venv/bin/python evaluate.py ocr-ordered
node render_reviews.mjs formulas-cached
node render_reviews.mjs heldout-structure
node render_reviews.mjs ocr-ordered
node render_reviews.mjs edge-cases
.venv/bin/python summarize_results.py
.venv/bin/python -m pip check
```

Rebuild an existing review with `review.py OUTPUT_DIRECTORY` after changing
normalization; use a new output directory for a fresh model conversion.
The latest scan runs are under `outputs/ocr-ordered/`; older scan runs remain
available as experimental history. See [README.md](README.md) for setup and formats.
