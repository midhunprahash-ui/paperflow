# Cloud OCR comparison — 2026-09-08

Azure Document Intelligence is a promising candidate for a Rpaper integration trial. It was faster in this six-document experiment and retained more source tokens on each document. It is not an exact replacement for the current pipeline. Mistral has not been tested: no API key was available.

## Measured results

Identical PDFs (SHA-256 recorded per run), 61 pages total. Docling ran locally on macOS, CPU with two threads, through the current `app_parse.py` including export and process startup. Azure ran in Central India, `prebuilt-layout`, API 2024-11-30, Markdown + figures + formula add-on. This is a deployment-option comparison, not a controlled hardware benchmark. Neither column includes the production queue delay. Azure timing includes upload and polling (two-second interval), but excludes subsequent figure downloads and Rpaper manifest conversion. One run per document; no p95 claim.

| PDF | Pages | Docling seconds | Azure seconds | Docling token overlap | Azure token overlap |
|---|---:|---:|---:|---:|---:|
| attention | 15 | 38.43 | 9.88 | 97.1% | 97.7% |
| resnet | 9 | 34.51 | 7.41 | 95.6% | 97.2% |
| bert | 16 | 35.52 | 7.34 | 92.4% | 98.0% |
| scikit-learn | 6 | 13.40 | 9.06 | 98.0% | 99.2% |
| alexnet | 9 | 19.33 | 5.08 | 96.8% | 98.8% |
| scikit-learn-scan | 6 | 39.01 | 9.16 | 97.4% | 99.0% |

Total measured wall time: Docling 180.20s; Azure 47.93s (3.8x lower for this experiment, subject to the timing differences above).

Token overlap is multiset recall against native PDF text, using the digital original for the scan. It is not an accuracy score: it does not measure extra invented text, reading order, equation meaning, typography, or cell placement. PDF extraction itself is an imperfect reference.

## Quality checks

Both parsers returned every page and matched all 83 selected heading-title anchors in order. Heading depth and complete multi-column reading order are not established by these checks.

- azure / scikit-learn: 36/36 source-reviewed data cells matched at the expected row and column on page 4.
- azure / scikit-learn-scan: 36/36 source-reviewed data cells matched at the expected row and column on page 4.
- docling / scikit-learn: 36/36 source-reviewed data cells matched at the expected row and column on page 4.
- docling / scikit-learn-scan: 26/36 source-reviewed data cells matched at the expected row and column on page 4.

- The scanned Docling table missed ten dash markers (unavailable-operation cells); all 26 other checked cells matched. Its table audit also flags these unassigned slots, so this is not a claim that numeric values were wrong.
- Azure classified the scikit-learn author/contact block on page 1 as an extra table, in both the digital and scanned PDF. Its table count is 2 versus the single actual benchmark table.
- Azure returned formula placeholders in the structured cells of Attention table 1. Formula objects/positions must be resolved by our adapter; copying cell text directly would lose the mathematical expressions.
- Visual comparison of Attention page 6 found Azure transcribed the sine equation’s `d_model` subscript as `d_madel`. The cosine equation kept `model`. Formula recognition is useful but not exact. Our current Docling app runs with formula enrichment disabled; its formula-region count must not be compared as a recognition score.
- Azure’s downloaded Transformer architecture figure crop was visually intact. Composite figures can be split: counts are not a quality verdict. All returned figure files were downloaded; exhaustive image/caption review remains open.

## Cost

The Azure Retail Prices API returned Central India S0 rates of $10/1,000 prebuilt pages plus $6/1,000 add-on pages. At one formula add-on per page, 61 pages implies about **$0.976** in analysis charges, before taxes/other usage. This is a retail estimate, not a verified invoice or credit deduction. Saved meters: `tmp/cloud-ocr-benchmark/azure-prices.json`.

Mistral’s current published OCR price is $4/1,000 pages: the same 61-page run would be about $0.244 at that rate, but no request was made and no quality or latency result is available.

## Recommendation

Complete the Mistral run before selecting a provider. Azure merits a small adapter trial with the current reader format, including formula resolution, figure/caption relationships, source coordinates, table validation, and preservation of source crops for uncertain equations. Keep the original PDF accessible. This benchmark does not authorize or perform a production parser switch.

The resource `rpaper-ocr-benchmark` (Document Intelligence S0, Central India) was created in `rpaper-staging`; it is a per-use service, not a persistent parser VM. No app revision, production document, database schema, or queue setting was changed. API keys were kept in process memory. Public research fixtures only were sent to Azure.

## Reproduce

```sh
docling-lab/.venv/bin/python docling-lab/cloud_benchmark.py docling
docling-lab/.venv/bin/python docling-lab/cloud_benchmark.py azure
# Add MISTRAL_API_KEY to ignored .env.local first:
docling-lab/.venv/bin/python docling-lab/cloud_benchmark.py mistral
docling-lab/.venv/bin/python docling-lab/cloud_benchmark_report.py
```

Successful runs are reused by input hash; choose a fresh output directory in the script before intentional repeated timing runs. Raw JSON, Markdown, measurements, source review PNGs, figure crops, and table audits are under `tmp/cloud-ocr-benchmark/`. Provider output is untrusted and has not been inserted into the app.

## Sources

- [Azure layout model](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/layout?view=doc-intel-4.0.0)
- [Azure analysis REST API](https://learn.microsoft.com/en-us/rest/api/aiservices/document-models/analyze-document?view=rest-aiservices-v4.0%20(2024-11-30))
- [Azure pricing](https://azure.microsoft.com/en-us/pricing/details/document-intelligence/)
- [Azure Retail Prices API](https://prices.azure.com/api/retail/prices)
- [Mistral OCR API](https://docs.mistral.ai/studio/document-processing/basic_ocr)
- [Mistral pricing](https://mistral.ai/pricing/api/)
