# Local app integration verification

Updated on 6 September 2026. The app now uses **hosted Supabase** from `.env.local`
with local Docling inference. Open **http://localhost:3001**, sign in with your
existing Rpaper account and upload a paper. Docker is not required. The
regression suite below was established against an isolated local database. A
separate authenticated upload has now also passed against hosted Supabase.

Hosted setup status: verified against Rpaper project `vhwnkwhiwnaqalngwjnl`.
Migration `20260906144925_docling_processing_api.sql` is installed. All six public
and private processing functions reject anonymous/browser execution and allow
only `service_role`; public wrappers use invoker security. Server-side REST
reaches the processing API, and the public key is denied direct execution.
Rpaper's local Docker stack is stopped. Docling still runs locally.

The hosted security advisor reports no error-level findings. It reports the
existing [disabled leaked-password protection setting](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection);
this integration does not change account password policy.

## Hosted integration check

A disposable test account uploaded the supplied six-page native paper through
HTTP preflight and dispatch on localhost:3001, using the same authenticated
upload/enqueue RPCs as the UI. Local Python inference then saved the result to
hosted Supabase and the authenticated reader returned HTTP 200.

- Parser `docling-local-v2`, schema version **2**, six pages.
- **137 blocks, 19 sections, 17 stored image assets**; every asset downloaded
  successfully. Server-rendered reader HTML contained 137 source blocks and 13
  image elements. This was an HTTP integration check, not a new visual browser
  evaluation of the hosted upload.
- All 29 test storage objects and the disposable account were removed afterward;
  independent database checks confirmed no test account, document or object
  remained. The pre-existing document retained its active version.
- Lint and TypeScript checks passed after switching the connection.

The local app now needs only its Node.js server and Python environment. The
hosted database migration is applied; Azure/model hosting remains a later step.

## What is integrated

PDF upload → authenticated validation → private source storage → claimed parsing
job → local Docling → version-2 structured manifest and image assets → reader.

- Accepts 1–16 pages and at most 25 MB. Corrupt, encrypted, blank and oversized
  inputs fail validation; the worker repeats validation before loading models.
- Retains every laboratory structure block in order, with source ID, section
  ownership and provenance. The reader respects explicit heading levels and
  displays captions, reference markers, inline formatting and merged table cells.
- Docling uses local CPU layout/table models and selective RapidOCR. No hosted
  inference API or rewriting/summarization model participates in new uploads.
- Uncertain formulas, some table cells and scanned paragraphs retain source
  images. OCR/LaTeX candidates remain unverified evidence, not certified text.
- The original PDF, raw and corrected Docling JSON, structure, OCR lines, formula
  candidates, inline/table/paragraph evidence, quality report and Markdown are
  retained. Markdown is wrapped in `paper-markdown.json` to fit the existing
  private bucket's JSON content-type policy.
- Images are saved before a service-only transaction creates the version/assets
  and marks the job ready. Ownership, unique attempt IDs and leases protect
  against cross-user access, stale completion and partial persistence. Private
  reader image URLs expire after an hour; reopening the reader refreshes them.
- Version-1 documents and the existing sample reader remain supported.

## Verification

| Check | Result |
|---|---|
| Python regression suite | 50 tests passed, including adapter fidelity and OCR heading evidence guards |
| Application unit tests | 22 tests passed |
| Database tests | 27 assertions passed against the isolated local database |
| Existing browser regressions | 4 passed across desktop Chromium and Pixel 7 |
| Code checks | ESLint, TypeScript and production build passed |
| Local database security advisor | No error-level findings |
| Corpus adapter coverage | 12 cases, 99 pages; all structure block IDs, order, owners and referenced assets retained |
| Selected corpus anchors | 160 checked; zero failures, missing assets or unmatched exports |
| Actual native PDF upload | 6 pages; 137 blocks, 19 headings, 13 images; no broken images or page errors |
| Actual synthetic scanned PDF upload | 6 pages; 137 blocks, 19 headings, 66 images; no broken images or page errors |
| Authenticated invalid input checks | Corrupt and 17-page PDFs rejected with HTTP 400 before document creation |
| Reader inspection | Native and scanned math reviewed; scanned mobile reader has no horizontal page overflow |

The supplied camera-ready paper was uploaded through the application's real UI,
job dispatch, Python inference, database completion and private asset loading.
The scan is a 180-DPI synthetic derivative of that paper, not an independent
physical scan. The other corpus outputs exercise the same adapter and parser
regressions; they were not each uploaded through the app.

The integration exposed and repaired a duplicate scanned heading caused by
full-page and region OCR reporting overlapping text. A repeat is removed only
when high-confidence source OCR evidence at overlapping bounds supports the
single heading. Unsupported, conflicting or low-confidence evidence leaves it
unchanged. Raw extraction stays immutable. Native font inspection also avoids
encoding embedded page images when only text/font evidence is needed.

## Reproduce the isolated regression setup

From the repository root, with Docker running and the laboratory Python
environment and models installed:

```sh
npm run setup:docling
npm run dev:docling -- --isolated
```

The setup creates `rpaper-docling-local` under ignored `tmp/docling-local` using
ports 58321–58329, and writes ignored `.env.docling.local` with owner-only
permissions. It preserves `.env.local` and does not migrate the hosted database.
On an existing local database, apply subsequent migrations without resetting data.

```sh
npm test
npm run lint
npm run build
npm run typecheck
docling-lab/.venv/bin/python -m pytest docling-lab -q
node scripts/verify-docling-upload.mjs
node scripts/verify-docling-upload.mjs docling-lab/inputs/camera-ready-scan.pdf
```

The upload verification scripts require the isolated stack and app to be running.
They create local test accounts and retain test papers for inspection. Session
state and screenshots stay in ignored `tmp/docling-local`; do not share that
folder. Python test XML is in `outputs/app-integration-tests.xml`.

## Remaining limits

Passing these defined checks does not establish perfect extraction of arbitrary
papers. The [parser edge-case report](EDGE_CASE_REPORT.md) describes the underlying
fidelity limits. Source images preserve appearance but scanned prose is not fully
reflowable/selectable verified text, and source equations are not verified semantic
LaTeX. Some hierarchy decisions still depend on document layout evidence.

This integration is a local Node.js/Python process, with one model inference at a
time through an OS file lock, a 15-minute process timeout and job heartbeats.
Waiting for the lock counts toward that timeout. A server restart needs the
processing page to be reopened for stale-job recovery. It is not a durable hosted
worker queue or an Azure deployment.

The next evaluation is reading additional papers in the actual local app. Hosting,
capacity, durable processing and a hosted database migration require their own
verification before production release.
