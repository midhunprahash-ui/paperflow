# paperflow

paperflow parses research PDFs with Azure Document Intelligence in the hosted app
and local development, and presents the paper's ordered
content and section hierarchy in the reader. Uploads accept **1–16 pages, up to
25 MB**. The original PDF remains available.

The hosted app uses a durable Azure queue and a lightweight worker.
See [Azure deployment](docs/AZURE_DEPLOYMENT.md) and the
[parser comparison](docs/CLOUD_OCR_BENCHMARK.md). Existing document versions remain readable.

## Run the integrated local app

The app at **http://localhost:3000** uses the hosted Supabase project configured
in ignored `.env.local`. Sign in with your existing paperflow account. **Docker is
not required**: Supabase provides hosted Auth, database and private Storage;
Azure Document Intelligence performs extraction using the same `prebuilt-layout`
model, `2024-11-30` API version, formulas option, and adapter as production.
Python runs PDF validation, thumbnails, and output normalization locally.

Configure `.env.local` from `.env.example`, including:

```dotenv
DOCUMENT_PARSER=azure-layout
DOCLING_DISPATCH_MODE=local
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=https://your-resource.cognitiveservices.azure.com/
```

Use the production Document Intelligence endpoint. Set `DOCLING_PYTHON` and
`DOCLING_SCRIPT` to the absolute paths of `docling-lab/.venv/bin/python` and
`docling-lab/app_parse.py`. These remain necessary for PDF preflight validation;
they do not select the extraction model.

```sh
npm install
# Python environment setup: docling-lab/README.md
az login
npm run dev
```

The signed-in Azure CLI user needs **Cognitive Services User** on the Document
Intelligence resource. Production uses its managed identity. No Azure API key
is required. Local OCR requests use the resource's Azure quota and billing.

Local dispatch runs the job from the Next.js server; it does not enqueue work
on the production queue. Keep the local server running during processing.
Existing document versions retain their original parser output. To compare a
previous Docling result with Azure, explicitly reprocess it or upload a new copy.

The legacy `dev:docling`, `build:docling`, and `start:docling` commands run on
**http://localhost:3001** and also honor `DOCUMENT_PARSER` from `.env.local`.
Their names do not force Docling. Rebuild after code changes when using `start:docling`.

React Grab is enabled when running `npm run dev` or `npm run dev:docling`.
Hover an element, press **⌘C** (Mac) or **Ctrl+C**, then paste its component/source
context into your coding agent. It is disabled in optimized production builds.

[Frontend performance and verification](docs/FRONTEND_REVIEW.md) records the
redesign, measured response times and desktop/mobile checks.

`dev:docling` reads `.env.local`, enables PDF processing and sets the Python interpreter
and entrypoint paths at runtime. Next.js does not bundle the Python environment.
The Docling processing migration is installed on the hosted paperflow project.
The Supabase MCP connection is authenticated and verified against that project.
Keep the dev server running while papers are processed. Hosted credentials stay
in ignored local environment configuration; the server secret never enters the
browser or the Python process.

For a separate, optional Docker-backed test database, run `npm run setup:docling`
and `npm run dev:docling -- --isolated`. That mode reads `.env.docling.local` and
uses the dedicated `rpaper-docling-local` stack. The upload regression script
below deliberately targets only this isolated test environment.

## Optional Docling comparison

To deliberately compare the alternative local model, set `DOCUMENT_PARSER=docling`
and follow the flow below. This is not the production-parity configuration.

1. An authenticated preflight validates the PDF and page count before creating an
   upload record. The processing worker repeats validation before model loading.
2. The browser uploads to its Auth UUID's private Storage prefix and enqueues a
   job. The dispatch route claims the exact owner/document/job/run combination.
3. Next.js starts the local Python parser after responding. An OS file lock
   serializes model inference on this machine; heartbeats protect queued/running
   attempts. The process has a 15-minute timeout. Server restarts require opening
   the processing page to recover stale jobs; this is not a durable hosting queue.
4. Docling performs layout recognition, selective OCR and table extraction. The
   lab's normalization and source-backed math repairs run unchanged. No OpenRouter
   request, summarization or rewriting model is used in this flow.
5. `app_export.py` creates a version-2 manifest with ordered typed blocks, the
   section tree, source ownership/provenance, explicit list markers, merged table
   cells, typed inline styles and asset references. Raw parser HTML is not injected
   into React.
6. Source images and evidence are saved under the owner's unique run prefix.
   A service-only transaction creates the version and asset rows and marks the
   document ready. Stale attempts cannot finish a replacement run. The reader
   signs private images in batches and preserves caption positions and references.

The original source, raw Docling JSON, corrected JSON, structure, quality report,
inline/paragraph/table evidence and Markdown are retained. Markdown is stored in
`paper-markdown.json` so the existing bucket's JSON content-type policy remains
valid. Version-1 papers continue to render. Old Cloudflare helpers and migrations
remain as history; explicit Docling comparison runs use Docling. Azure Layout runs
save raw JSON, quality reports, v2 manifests, and original-source image crops.

Azure LaTeX candidates render through the existing server-side KaTeX renderer,
including inline equations, numbered display equations and math in table cells.
Original crops remain available for comparison and replace missing or unsupported
LaTeX. Successful typesetting does not verify transcription accuracy. Older papers
without inline candidates need reprocessing to gain inline math rendering; opening
a paper does not trigger OCR or download its raw analysis result.

## Fidelity and testing

[The lab report](docling-lab/EDGE_CASE_REPORT.md) describes what parsing has and has
not established. Uncertain formulas, some table cells and scanned paragraphs use
source images. Those preserve appearance but are not verified semantic LaTeX or
fully reflowable OCR. Integration preserves these explicit fallbacks rather than
turning uncertain text into a claim of accurate transcription.

```sh
npm run lint
npm test
npm run build
npm run typecheck
docling-lab/.venv/bin/python -m pytest docling-lab -q
# Creates a test user and uploads the lab paper only to the isolated local stack:
node scripts/verify-docling-upload.mjs
```

The full upload test requires the local stack and `dev:docling` to be running and
the lab corpus to exist. Its session file and screenshots stay under ignored
`tmp/docling-local`. It deliberately refuses a hosted Supabase URL.

See [the integration verification report](docling-lab/APP_INTEGRATION.md) for the
local checks. The Azure deployment guide records hosted verification separately.

[Azure deployment](docs/AZURE_DEPLOYMENT.md) documents the separate web/worker
images, managed-identity queue configuration, and release checks. Local mode
remains the default; the Azure web image enables durable queue dispatch.
