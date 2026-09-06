# Docling local evaluation — 6 September 2026

**Historical first-pass report.** See the [complete structure audit update](STRUCTURE_REPORT.md)
for subsequent repairs, the 137-block source inventory, and two additional papers.

The standalone experiment is working: every test PDF has a Markdown export,
structured JSON, images, and a side-by-side source comparison. **Docling alone has
not yet met the application's full fidelity requirement.** The repaired outputs
pass the selected structural checks, but inline mathematics, OCR text, complex
tables, and some metadata/relationship reconstruction remain imperfect.

Open [all test cases](index.html), [your paper's comparison](outputs/formulas-cached/camera-ready/review.html),
or [your paper's Markdown](outputs/formulas-cached/camera-ready/paper.md).
Keep the Markdown with its accompanying image folders.

## What was tested

Ten PDFs, 80 pages: six original research papers (61 pages), three synthetic
scan/mixed variants (18 pages), and a controlled structure fixture (one page).
Each case was run both without and with local formula recognition. Additional
targeted runs investigated formula performance and an OCR-runtime shutdown crash.

| Original paper | Pages | Main coverage |
|---|---:|---|
| User camera-ready paper | 6 | IEEE two columns, Roman/lettered headings, seven display equations, four figures, one real table, numbered references |
| [Attention Is All You Need](https://arxiv.org/abs/1706.03762) | 15 | NeurIPS single column, three heading levels, math, tables, composite figures |
| [Deep Residual Learning](https://openaccess.thecvf.com/content_cvpr_2016/html/He_Deep_Residual_Learning_CVPR_2016_paper.html) | 9 | CVPR two columns, wide tables, plots, equations |
| [Scikit-learn](https://www.jmlr.org/papers/v12/pedregosa11a.html) | 6 | JMLR single column, large author roster, accents, table, author-year references |
| [BERT](https://aclanthology.org/N19-1423/) | 16 | ACL two columns, tables, footnotes, references followed by lettered appendices |
| [AlexNet](https://www.cs.toronto.edu/~kriz/imagenet_classification_with_deep_convolutional.pdf) | 9 | Single-column body with three author columns, inline/display math, nested headings |

The synthetic variants are the user paper rendered as 180-DPI grayscale scans,
the same paper with alternating native/scanned pages, and Scikit-learn rendered
as 120-DPI grayscale scans. The fixture checks three heading levels, an indented
bullet, and a table with a two-column merged cell. These are not physical scanner
samples, and the corpus is a development set, not a held-out benchmark.

Downloads and hashes are recorded in `corpus.json` and `inputs/sources.json`.
All PDFs are limited to 16 pages; an automated boundary check accepts 16 and
rejects 17 before model loading. Source files are unchanged.

## Models and configuration

Docling 2.126.0, docling-core 2.95.0, docling-parse 7.17.0, Heron layout,
TableFormer accurate mode, RapidOCR with ONNX Runtime, and optional CodeFormulaV2.
CPU inference uses two threads and small batches on this 8-GB Mac. There is no
hosted inference API or rewriting/summarization LLM in this experiment.

Heading hierarchy is explicitly enabled; it should not be assumed from a plain
Markdown export. See [Docling's heading documentation](https://docling-project.github.io/docling/usage/heading_levels/).
Formula recognition is an enrichment stage, documented in
[Docling's enrichments guide](https://docling-project.github.io/docling/usage/enrichments/)
and the [CodeFormulaV2 model card](https://huggingface.co/docling-project/CodeFormulaV2).

Recorded model revisions used by the installed cache:

- Heron: `8f39ad3c0b4c58e9c2d2c84a38465abf757272d8`
- Docling models/TableFormer: `2199320848bb9a8a519d22e4b528185a4f9a6f64`
- CodeFormulaV2: `ecedbe111d15c2dc60bfd4a823cbe80127b58af4`

Python dependencies are pinned in `requirements.txt`. A fresh machine can fetch
new model revisions unless its model cache is also pinned; these measurements
describe this recorded local run.

## Failures found and repairs applied

| Observed failure | Repair and evidence |
|---|---|
| Numbered, Roman, and lettered headings had incorrect depths | Recover levels from explicit numbering; retain source text and log changes. Selected three-level and appendix anchors pass. |
| The user's Mathematical Formalisms subsection was a list item | Promote it using its letter marker, source style, and column/list context. Its content follows Model Architectures. |
| A results paragraph spanning columns moved before its section | Anchor a multi-span paragraph to its first source span; preserve atomic paragraphs while ordering columns. Regression check passes. |
| Author columns confused single-column reading order in AlexNet | Require body content in both columns; sort single-column pages by source position. Abstract precedes Introduction again. |
| An author email was joined to next-page body text | Split only where a native source email proves the boundary; retain both pieces and their locations. |
| Titles were section headers or appeared late in raw order | Use first-page source position and font prominence to recover titles, including Attention and Scikit-learn. |
| Small capitals split heading words | Join only recognized split heading words; preserve genuine multiword uppercase text. |
| Two figures in the user's paper were extracted as tables | Use their explicit figure captions to display original source crops. Raw data and overrides remain available. |
| Merged cells were flattened by Markdown tables | Export those tables as HTML with row/column spans inside Markdown. Controlled merged-cell fixture passes. |
| An indented bullet became a peer bullet | Restore nesting from source indentation. Controlled list fixture passes. |
| Reference 7 continued in the next column as a falsely numbered item | Join only a markerless continuation between consecutive bracketed references at a source column/page boundary. |
| Leading equation symbols were separate text blocks | Reunite adjacent symbols with equation crop bounds; remove duplicate displayed fragments. |
| Formula recognition was extremely slow on CPU | Use batch size one, float32 and explicitly enable the model's generation cache. One short equation fell from about 83 seconds to about 4–5 seconds. |
| Scanned Scikit-learn crashed after writing its outputs | macOS crash stacks identified ONNX Runtime's telemetry uploader. Disable telemetry before initialization; two targeted reruns exited cleanly. |

The telemetry switch follows [ONNX Runtime's documented runtime opt-out](https://github.com/microsoft/onnxruntime/blob/main/docs/Privacy.md).
The two original failed runs remain in their logs. They are not counted as clean
process exits simply because they produced files. The index uses the repaired
Scikit-learn scan run. This is a tested local mitigation, not a guarantee about
all operating systems or long-running services.

## Verification and measured results

- All ten final case bundles exist: 80 source pages, Markdown, JSON, and review HTML.
- **133 selected heading anchors** pass their presence, depth, and order checks.
  Selected page/figure/table counts also pass. This is not exhaustive hierarchy validation.
- **13 regression tests pass**, including reading-order regressions, 16-page
  enforcement, encrypted-input rejection, source hashes, nested bullets, merged
  cells, titles, reference continuation, and table values.
- All **42 numeric cells** in the user's main table match the manually inspected
  source values in their expected rows and columns. This does not validate every
  cell of every table in the corpus.
- All seven detected display equations in the user's paper appear as source
  image crops. Candidate LaTeX is retained separately and marked unverified.
- No missing Markdown image assets or unmatched table/formula replacements in
  the final bundles. Headless browser checks found no page-script errors or
  broken reader images.
- Dependency checking passes. PyMuPDF emits non-fatal SWIG deprecation warnings
  during tests.

[Per-paper measurements](MEASUREMENTS.md) and [machine-readable results](results.json)
include raw-versus-corrected anchor failures, time, peak process memory, and text
coverage. With formula recognition, the six original papers took about **22–97
seconds** for parsing/initial export. The user's paper took **92.5 seconds** for
that stage (about 95 seconds including review/shutdown). Its synthetic scan took
about **188 seconds**. These are individual Mac runs, not throughput benchmarks
or Azure capacity estimates. Initial environment/model setup is excluded.

Text token recall ranges from about 89% to 98% for original papers. It is a
bag-of-words diagnostic affected by headers, figure labels, accents, mathematics,
and extraction differences; it cannot establish sentence correctness or order.
For scanned variants, comparison is against their digital originals. A high
recall can coexist with visibly garbled words.

Every page was rendered for comparison. Visual inspection covered source overview
renders of all six originals, first-page reader comparisons for all ten cases,
the user's mathematical/table pages, and the controlled fixture. This was not a
character-by-character human transcription of all 80 pages. The abstract-order
failure discovered visually was added to the regression checks.

## Remaining failures — do not promote yet

1. **Reliable LaTeX is unresolved.** On the user's equations, recognition dropped
   vector arrows, misread subscripts, and interpreted brackets as letters.
   `paper.md` therefore displays original equation crops by default, even with
   `--formulas`. `formula-candidates.json` contains unapproved recognition results.
   Crops preserve appearance; they are not editable/searchable mathematical data.

2. **Inline math is still lossy.** Subscripts, superscripts, bold symbols and
   inline relationships can become flat text inside paragraphs. Display-equation
   crops do not repair inline mathematics or equations the detector misses.

3. **Complex tables need further validation.** ResNet's runtime logs include a
   dropped-cell warning and nearest-row/column assignments. Recognizing eight
   table objects does not prove their cells are correct. Per-run
   `runtime-warnings.json` preserves this evidence; the source pages remain
   available. Some table warnings concern figure regions that were reclassified.

4. **Scanned text contains OCR errors.** The user-paper scan visibly corrupts
   words in its abstract, despite roughly 98% token recall. Low-resolution JMLR
   text and native accented names also contain errors. No language model has
   guessed replacements. Rotation, skew, photographs, handwriting and physical
   scan degradation have not been covered by this corpus.

5. **Relationships and typography are incomplete.** Author/email associations
   are still imperfect; some author names become unnumbered headings. Run-in
   bold labels and inline emphasis can disappear. Some figure captions include
   preceding plot-axis labels, and composite figures may be multiple image
   objects. Citation text is retained, but citation-to-reference and footnote
   links are not fully reconstructed or validated.

6. **The adapter is still experimental.** Explicit numbering repairs are
   stronger than inferred unnumbered hierarchy. Column heuristics need held-out
   tests. `document.json` records normalized structure, but table-to-figure
   overrides and pixel fallbacks also require `quality.json` and assets; it is
   not yet a finished application manifest. Absorbed source items remain in the
   underlying node arrays for traceability but are detached from reader traversal.

The next evaluation should target these specific failures with source-grounded
cell/math annotations and a new held-out corpus. The full-fidelity acceptance
condition has not passed, so localhost integration, Azure hosting, and production
deployment have not been performed. Existing application work was left intact.
