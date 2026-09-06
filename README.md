# Rpaper

Rpaper turns PDF research papers into page-organized reading copies and keeps the original PDF available for figures, tables, equations, and exact formatting.

## Architecture

- **Web:** Next.js 16, React 19, TypeScript, KaTeX.
- **Data:** Supabase Auth, Postgres, RLS, Realtime, and private Storage.
- **Parser:** OpenRouter file-parser with the explicit `cloudflare-ai` engine.

The browser uploads to an owner-scoped Supabase Storage path and enqueues a job.
The authenticated dispatch route claims that exact job and schedules processing
with Next.js `after()`. It downloads the PDF server-side, calls OpenRouter, and
normalizes the raw file annotations into the reader manifest. The free model
router only acknowledges the request; its generated answer is not used as the
extracted document. There is no paid OCR or alternate parser fallback.

Both the raw parser text (`extraction.json`) and the reader (`manifest.json`)
are stored under the owner's document and processing-run path. Completion
atomically creates the version and updates the document/job through a
service-role-only RPC. Duplicate dispatches do not run the same active job;
stale runs can resume after five minutes with a new run ID. A stale worker cannot
complete or fail the replacement run. Process restarts require the processing
page to be opened for recovery; this is not a durable background queue.

Cloudflare text extraction can flatten tables, damage mathematical notation,
and omit figures. The reader retains the Original link for faithful viewing.
New uploads accept PDF only; export DOCX files to PDF first.

## Docling evaluation

The standalone [Docling lab](docling-lab/README.md) evaluates local parsing with
a 16-page limit, structured hierarchy, tables, figures and source-backed math.
See its [test report](docling-lab/EDGE_CASE_REPORT.md) for verified results and
remaining fidelity limits. It is separate from the app's current Cloudflare
integration. Downloaded PDFs, model environments and generated review assets
remain local and are excluded from Git.

## Local setup

```bash
npm install
cp .env.example .env.local
# Fill in Supabase configuration and OPENROUTER_API_KEY locally.
npm run dev
```

If `.env.local` already exists, edit it instead of overwriting it. The server
needs `SUPABASE_SECRET_KEY` and `OPENROUTER_API_KEY`. No Modal credentials,
Python environment, GPU, or direct database password are needed at runtime.
Without Supabase configuration the app runs in demo mode.

Apply the migrations to your selected Supabase project before processing real
uploads. The Cloudflare migration is
`supabase/migrations/20260906091102_cloudflare_processing_api.sql`.
It adds server-only claim, completion, and failure RPCs; browser roles cannot
call them. Existing migration history is retained.

## Hosting

The dispatch handler requires a Node.js deployment supporting Next.js `after()`
and a 300-second function duration. OpenRouter requests have a 180-second timeout.
Configure the same server-only keys on your host. Free endpoint availability and
rate limits still apply; failures are shown on the processing screen and can be
retried without re-uploading the PDF.

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

Upload limits: 25 MB, 100 parsed pages, five retained documents per user.
Keep keys in ignored local configuration, never in frontend code or Git.
The Supabase Auth UUID remains the canonical document owner. Rendering uses
escaped typed nodes; raw parser HTML is never injected into the reader.
