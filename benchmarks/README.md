# Adaptive parser benchmark

This benchmark evaluates document parsers against a real, difficult two-column
research paper. It keeps the source PDF and full parser outputs under `tmp/`, so
private documents and large generated assets are never committed.

## Parsers

- Docling 2.67.0: the current production baseline.
- Marker 1.10.2: layout, text, table, and math extraction on Modal GPU. Marker
  2.0 is documented separately because it requires a second Surya inference
  service and is not a drop-in replacement for the current free-tier worker.
- MinerU 3.4 hybrid/high: a second layout-and-math parser on Modal GPU.
- GROBID: metadata and bibliography specialist; it is evaluated as a supplement,
  not as the renderer for the reader UI.

No single parser is expected to win every category. The intended production
architecture is a primary full-document parser plus specialist repair passes.

## Run

```bash
worker/.venv/bin/modal run benchmarks/modal_marker.py \
  --input-pdf "/absolute/path/to/paper.pdf" \
  --output-file tmp/parser-benchmark/marker.json

worker/.venv/bin/modal run benchmarks/modal_mineru.py \
  --input-pdf "/absolute/path/to/paper.pdf" \
  --output-file tmp/parser-benchmark/mineru.json

worker/.venv/bin/modal run benchmarks/modal_grobid.py \
  --input-pdf "/absolute/path/to/paper.pdf" \
  --output-file tmp/parser-benchmark/grobid.json

python3 benchmarks/score_outputs.py \
  --ground-truth benchmarks/ground_truth/iciit381.json \
  --input docling=tmp/pdfs/iciit381/docling-manifest.json \
  --input marker=tmp/parser-benchmark/marker.json \
  --input mineru=tmp/parser-benchmark/mineru.json \
  --output tmp/parser-benchmark/scores.json
```

The automatic score is a regression signal, not a substitute for page-by-page
visual review. In particular, equations and figure/table boundaries require a
human check before changing the production parser.
