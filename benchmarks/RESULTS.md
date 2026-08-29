# Parser decision for scientific papers

## Decision

Use **MinerU 3.4 hybrid/high as the primary scientific-paper parser**, with
**GROBID 0.9.1 as a metadata and bibliography repair pass**. Keep Docling as a
lower-cost fallback and for formats or pages MinerU rejects.

Do not attempt to choose IEEE, Springer, ACM, or another template manually.
The router should classify page characteristics (born-digital versus scanned,
column count, math/table density, and parser confidence), not publisher names.

## Controlled fixture

The private six-page camera-ready paper was inspected page by page and used as
the benchmark fixture. It contains a three-column author block, two-column body,
nested headings and numbered lists, four figures, seven display equations, a
seven-row native results table, a screenshot-like table, and 22 references.

Full parser outputs and the source PDF live under ignored `tmp/` paths. Only the
ground truth, runner, scorer, and this non-sensitive summary are committed.

## Human-reviewed result

| Parser | Read order and hierarchy /25 | Math /20 | Tables /15 | Figures /15 | Metadata and references /15 | Deployability /10 | Total /100 |
|---|---:|---:|---:|---:|---:|---:|---:|
| MinerU 3.4 hybrid/high | 21 | 20 | 15 | 12 | 14 | 6 | **88** |
| Marker 1.10.2 | 20 | 17 | 14 | 10 | 12 | 8 | **81** |
| Docling 2.67.0 | 12 | 12 | 11 | 13 | 8 | 10 | **66** |

GROBID is not scored as a visual renderer. In its specialist role it extracted
the correct title and all 22 bibliography entries, although the author-name
structure still needs normalization.

The automatic regression score is intentionally secondary. Token-presence can
award points to a malformed equation or a reference split across blocks; the
human score above checks semantic and visual fidelity.

## Evidence

### MinerU 3.4 hybrid/high

- Correct page-one sequence: title, all three authors, abstract, keywords, then
  Introduction.
- Recovered all seven equations with labels 1 through 7. It correctly retained
  `\in` in equation 4, restored equation 5's number, and kept the negative
  exponent in equation 7.
- Recovered the native results table as 7 columns by 7 data rows and converted
  the screenshot-like confidence table into usable HTML.
- Produced all 22 continuous references; references 7 and 19 were not broken
  into separate list items.
- Preserved three raster image links and represented Figure 4 as structured
  data. Its optional image-analysis text included an inaccurate description of
  Figure 1, so production must pass `--image-analysis false` and retain original
  figure crops instead.
- Successful L4 run: 243.722 seconds including cold model setup. The T4 run
  failed during vLLM engine initialization, so hybrid/high is not a T4 worker.

### Marker 1.10.2

- Correct page-one sequence and all major headings, but heading levels were
  inconsistent (major sections varied from H1 to H4).
- Recovered seven display equations. Equation 4 misread `\in` as epsilon and
  equation 5 lost its number.
- The native results table was accurate. The dataset screenshot was converted
  into an oversized table, which is less faithful than retaining the figure.
- Found all 22 references, but reference 7 was split into a second bullet.
- Successful T4 run: 105.381 seconds including cold model setup.
- Marker 2.0 was also tested. Its default Surya vLLM backend requires a separate
  inference service and attempted to launch Docker inside the Modal function;
  it is therefore not a drop-in free-tier worker replacement.

### Current Docling 2.67.0 baseline

- Recovered four figures, seven formula blocks, and the native results table.
- Page-one reading order crossed columns incorrectly, all headings were flattened
  to level 1, and the author metadata was empty.
- The dataset screenshot was duplicated as both a figure and a malformed table.
- Equations 5 through 7 contained semantic errors, and references were generic
  list items with split entries.
- It remains useful as the already-deployed T4 fallback.

### GROBID 0.9.1 CRF

- Correct title and 22 structured bibliography entries.
- Author extraction found all three authors but needs deterministic cleanup for
  name order and duplicated affiliation text.
- CPU service startup plus parsing took 75.67 seconds.
- It should repair header/reference semantics only; its TEI output is not a
  replacement for figure, table, or equation rendering.

## Production parser route

1. Inspect the PDF locally for page count, embedded text, scan ratio, column
   layout, and math/table density.
2. Route scientific PDFs to MinerU hybrid/high on an L4. Disable generated image
   analysis and keep original figure crops.
3. Run GROBID header and reference extraction alongside MinerU. Merge only
   fields that pass deterministic checks (title similarity, author count, and
   continuous bibliography numbering).
4. Validate invariants: monotonically increasing page/order coordinates,
   continuous equation/reference labels, non-empty captions, table dimensions,
   and no duplicated figure/table regions.
5. If MinerU fails or the validation score is low, use Docling and preserve the
   original page/crop for every uncertain block.
6. Store both the normalized reader manifest and parser provenance/confidence so
   later parser upgrades can regenerate a document without overwriting history.

## Upstream references

- [MinerU repository and private deployment](https://github.com/opendatalab/MinerU)
- [MinerU CLI options](https://opendatalab.github.io/MinerU/usage/cli_tools/)
- [Marker repository](https://github.com/datalab-to/marker)
- [Marker Modal example](https://github.com/datalab-to/marker/blob/master/examples/marker_modal_deployment.py)
- [GROBID service API](https://grobid.readthedocs.io/en/latest/Grobid-service/)
- [GROBID Docker deployment](https://grobid.readthedocs.io/en/latest/Grobid-docker/)
