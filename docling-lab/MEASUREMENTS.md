# Local measurements

CPU, two threads. Formula recognition is shown per run; the two later structure checks use it off. Time covers parsing and initial JSON/Markdown export, excluding review generation and process shutdown. RSS is peak per process, not total machine usage. Scan rows use their digital originals for token recall.

| Case / visual comparison | Pages | Math model | Seconds | Peak GiB | Selected anchor failures: raw → corrected | Token recall (diagnostic only) |
|---|---:|---|---:|---:|---:|---:|
| [alexnet](outputs/formulas-cached/alexnet/review.html) | 9 | on | 96.7 | 2.17 | 17 → 0 | 98.32% |
| [attention](outputs/formulas-cached/attention/review.html) | 15 | on | 70.5 | 2.29 | 4 → 0 | 93.43% |
| [bert](outputs/formulas-cached/bert/review.html) | 16 | on | 45.3 | 2.31 | 15 → 0 | 94.88% |
| [camera-ready](outputs/formulas-cached/camera-ready/review.html) | 6 | on | 92.5 | 2.00 | 9 → 0 | 98.59% |
| [camera-ready-mixed](outputs/ocr-ordered/camera-ready-mixed/review.html) | 6 | off | 54.1 | 1.90 | 9 → 0 | 98.53% |
| [camera-ready-scan](outputs/ocr-ordered/camera-ready-scan/review.html) | 6 | off | 58.9 | 1.77 | 9 → 0 | 98.59% |
| [mobilenet-v2](outputs/heldout-structure/mobilenet-v2/review.html) | 11 | off | 30.0 | 1.79 | 3 → 0 | 93.69% |
| [resnet](outputs/formulas-cached/resnet/review.html) | 9 | on | 70.7 | 1.92 | 3 → 0 | 90.88% |
| [scikit-learn](outputs/formulas-cached/scikit-learn/review.html) | 6 | on | 22.2 | 1.54 | 2 → 0 | 95.79% |
| [scikit-learn-scan](outputs/ocr-ordered/scikit-learn-scan/review.html) | 6 | off | 37.7 | 1.87 | 2 → 0 | 97.42% |
| [structure-fixture](outputs/formulas-cached/structure-fixture/review.html) | 1 | on | 10.5 | 2.14 | 0 → 0 | 100.00% |
| [unet](outputs/heldout-structure/unet/review.html) | 8 | off | 16.1 | 1.67 | 8 → 0 | 94.81% |

Zero selected-anchor failures does not certify complete hierarchy, content, table or math fidelity. See [the full structural audit update](STRUCTURE_REPORT.md) and [original evaluation](REPORT.md). Raw and corrected outputs share the same immutable extraction run.
