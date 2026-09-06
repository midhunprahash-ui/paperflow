# Complete structural audit update

For the subsequent inline mathematics and typography work, see
[the inline formatting report](INLINE_REPORT.md). The math limitations below
describe this earlier structural pass.

The user's six-page paper now passes a complete, manually source-reviewed
**137-block / 19-section** inventory. The audit checks content type, owning
section, first source page, logical order, and whether any output blocks remain
unaccounted for. This closes the gap left by the earlier selected-heading checks.
It does **not** certify mathematical transcription, OCR, or all typography.

Open the [updated paper comparison](outputs/formulas-cached/camera-ready/review.html),
[Markdown](outputs/formulas-cached/camera-ready/paper.md),
[complete block audit](outputs/formulas-cached/camera-ready/STRUCTURE_AUDIT.md),
or [explicit section tree and content ownership](outputs/formulas-cached/camera-ready/structure.json).
The comparison page now has a working section outline.

## Source-based acceptance test

All six original pages were visually inspected. The expected inventory is checked
in as [camera-ready-structure.tsv](camera-ready-structure.tsv). It was written from
the source pages, with source-text anchors and printed section numbering; it is
not generated from the parser's output or injected into parsing.

`audit_structure.py` rebuilds ownership from the actual saved `document.json` and
compares it with that independent inventory. It also rejects a different PDF
hash, so this detailed gold file cannot silently be applied to another document.

The pre-change snapshot produced **12 failure records**, including incorrect
ownership of the entire dataset list and its figure. The repaired output produces
**zero**. The snapshot and its failing audit remain under
`outputs/structure-audit-before/`; failure records can cover multiple affected
blocks and should not be interpreted as a universal accuracy percentage.

All **4,186 native word centers** across the six source pages fall within retained
block regions, with a two-point tolerance. That is geometry coverage, not proof
that those words or symbols were transcribed correctly. Figure regions count as
covered because their source pixels are retained.

## Repairs completed

- The sentence introducing the five dataset groups remains bold text inside
  `III → A. Dataset Curation`; it no longer creates a false sibling subsection.
- The abstract's final word and the introductory paragraph split across columns
  are joined to their original paragraphs.
- The positive-feelings list item retains its continuation across columns,
  including `well-being`, as one item under `III → B → 2. Emotional Tone`.
- The two numbered evaluation metrics are actual list items under `V → A`.
- Reference 19 retains its URL inside the same bibliography entry. There are
  22 reference entries, and the earlier repair to reference 7 is preserved.
- Separate author email and ORCID blocks are grouped with their source author
  columns; they are not merged into unrelated paragraphs.
- Figure captions follow their figures where the source does; the real table's
  caption stays above its table.
- `structure.json` provides explicit section parents/children, block ownership,
  list membership, metadata associations, caption-to-asset links, and provenance.
  Formula numbers are read from native source regions where available.
- Numbered, lettered, and nested section relationships remain intact, including
  the four feature-category headings and the mathematical subsection's content
  continuing onto page 5.

One source ambiguity is deliberately recorded: after category `III/B/4`, the
paper has a closing feature-processing paragraph without a printed section-end
marker. The audit retains its source-flow placement under the last heading; it
does not invent an unmarked return to the parent section from semantic guesses.

## Regression coverage and additional papers

Both saved extraction modes of the original ten cases were reprocessed through
the changed normalization code. Their **133 selected heading anchors** and
selected figure/table/page counts still pass. Model inference was not needlessly
repeated for those unchanged raw extractions.

Two additional papers were then downloaded and parsed locally:

| Paper | Pages | New check |
|---|---:|---|
| [MobileNetV2, CVPR](https://openaccess.thecvf.com/content_cvpr_2018/html/Sandler_MobileNetV2_Inverted_Residuals_CVPR_2018_paper.html) | 11 | Two-column layout, nested sections, seven tables, run-in acknowledgements |
| [U-Net, Freiburg/arXiv](https://lmb.informatik.uni-freiburg.de/Publications/2015/RFB15a/) | 8 | Single-column layout, figures, equations, two tables, standalone acknowledgements |

The source previews exposed two terminal-section problems: MobileNetV2's run-in
heading was merged with its paragraph; U-Net's acknowledgement heading had the
wrong depth. Repairs use the source heading label and font evidence. U-Net's
printed spelling, **Acknowlegements**, is intentionally retained.

Initial results are saved as `initial-evaluation.json`, `initial-paper.md`, and
`initial-structure.json` inside each new case. `heldout-corpus.json` records URLs,
hashes, and the parser hashes used on their initial runs. After using their
failures for repairs, these cases are now regression data, not an untouched
held-out estimate of general accuracy.

The combined corpus is **12 PDFs / 99 pages**. The two new cases use formula
recognition off because this pass evaluates structure; their detected equations
still have source-image fallbacks. Their initial conversions took about 32 and
18 seconds including review/shutdown. See [measurements](MEASUREMENTS.md) and
[all comparisons](index.html).

Final regression checks: **20 tests pass**, **160 selected heading anchors pass**,
and all twelve comparison bundles have no broken reader images or section-outline
links. Dependency checking and Python compilation pass. The source-specific
137-block audit remains separate from these selected corpus checks. A fresh end-to-end run of the user PDF also exited cleanly in 44.8 seconds and passed the same complete structural audit; its artifacts are under `outputs/structure-smoke/camera-ready/`.

## Remaining mismatch ledger

| Remaining issue | Evidence / disposition |
|---|---|
| Inline mathematical formatting | User paper, page 4, Mathematical Formalisms: subscripts, superscripts, vector arrows, and bold variables in paragraphs remain imperfect. Source bounds are retained; this pass does not approve their transcription. |
| Unreliable generated LaTeX | The seven display equations use original source crops. Candidate LaTeX remains unverified in `formula-candidates.json`; a structural pass does not approve it. |
| Lost punctuation and hyphens | The native comparison flags 24 text blocks. Examples include the missing keyword separator and removed compound-word hyphens. Some other flags are quote normalization or list markers represented structurally. No automatic wording changes were made from this diagnostic. |
| Run-in emphasis | Labels such as Text Representation and Feature Fusion still need faithful inline styling. Recovering a terminal acknowledgement section does not solve arbitrary inline label detection. |
| OCR and complex tables elsewhere | Scanned-text errors and earlier ResNet dropped-cell warnings remain open. The user's main table still passes its 42-cell numeric check. |
| Citation navigation | Bibliography entries and their ownership are checked, but full citation-to-reference and footnote navigation is not yet implemented. |

Every native text-difference candidate includes source-region text, output text,
character differences and a `needs_visual_review` status in
[content-diagnostics.json](outputs/formulas-cached/camera-ready/content-diagnostics.json).
The diagnostic ignores whitespace and normalizes Unicode. It cannot detect
formatting errors or characters absent from both native extractors; some flags
can come from approximate source bounds. It is not an automatic fidelity score.

The general repairs are in `structure.py`; source-specific expectations live
only in the audit file. Per-output `quality.json` records normalization file
hashes. The new tests check the complete inventory, deliberately remove/duplicate/
misplace blocks to prove the audit fails, verify section ownership and caption
links, and cover the new terminal-section cases.

The next unresolved fidelity task is inline math and source typography, followed
by table-cell validation and scanned-text accuracy. The application's localhost,
database, Azure, and production integrations were not changed by this audit.
