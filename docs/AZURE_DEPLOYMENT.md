# Deploy Rpaper to Azure

The web app and PDF worker run on Azure. Keep the existing Supabase project for
Auth, Postgres, and private Storage. No database migration is required for this
deployment mode. Do not reset the hosted database or recreate existing users.

## Before creating resources

Choose an Azure subscription, region, and monthly budget. Check that the region
supports Container Apps Jobs and has enough CPU quota. The worker uses CPU;
Azure inference services and a GPU are not required.

Install Azure CLI, sign in interactively, and select the intended subscription:

```sh
brew install azure-cli
az login
az account list --output table
az account set --subscription '<subscription ID>'
az extension add --name containerapp --upgrade
```

Creating the resources below incurs Azure charges. Estimate costs for web
replicas, worker execution time, image storage, queue operations, and logs using
the chosen region and subscription. Budget alerts are notifications, not a hard
spending limit. Keep Supabase costs in the estimate too.

## Resources to create

Use one resource group and a Container Apps environment. Start with:

| Resource | Purpose / initial configuration |
| --- | --- |
| Azure Container Registry | Private images; Basic SKU |
| Storage account | Standard LRS; queues `docling` and `docling-poison` |
| User-assigned web identity | Queue sender and private image pull |
| User-assigned worker identity | Queue reader/writer and private image pull |
| Container App | Web target image; external HTTPS ingress to port 3000 |
| Container Apps Job | Worker target image; event trigger from `docling` |

For a staging benchmark, start the web app at 1 CPU / 2 GiB with one replica and
the worker at 4 CPU / 8 GiB. These are starting allocations, not verified sizing.
Adjust after measuring a 16-page scan, tables, and concurrent uploads. Configure
one replica per job execution, a 1,500-second execution timeout, and zero platform
retries (the queue handles redelivery). Use a 60-second polling interval and a low
maximum executions value during evaluation. That value limits launches per poll;
it is not a global concurrency or spending cap.

Grant `AcrPull` to both identities on a registry using RBAC registry permissions.
If using an ABAC-enabled registry, use the appropriate repository reader role.
Grant the web identity `Storage Queue Data Message Sender` on the `docling` queue.
Grant the worker identity `Storage Queue Data Contributor` on the queue service
so it can receive/update/delete work and send poison messages. Attach the matching
identity to each app/job and configure registry pulls with that identity.

For the job's `azure-queue` scaler, set `accountName` to the storage account,
`queueName=docling`, and `queueLength=1`. Configure the scaler to use the worker's
managed identity too; runtime identity settings alone do not configure the scaler.
No storage account key or connection string is required by this application.

## Build the two Linux images

Run from the repository root. Set these shell variables to public configuration
only: `RPAPER_REGISTRY` (registry name), `RPAPER_SUPABASE_URL`,
`RPAPER_SUPABASE_PUBLIC_KEY`, and `RPAPER_SITE_URL` (final HTTPS website origin).
Use the final custom domain, or obtain the generated Azure web-app hostname
before the final build. Next.js embeds `NEXT_PUBLIC_*` values during the build;
changing runtime settings alone does not update the browser bundle.

The user has reported an Azure account with $250 in free credits. Verify the
remaining balance, expiration date, offer restrictions, and spending-limit state
after login. Credit amount is not a recurring monthly budget.

Microsoft currently documents that ACR task runs are paused for Azure free-credit
subscriptions. Do not depend on `az acr build` for this account or upgrade its
billing offer to work around that restriction. Check subscription capabilities
first; use an eligible Linux CI runner or a temporary Azure Linux build VM if
needed, with its cost and cleanup included in the deployment plan. The Docker
build commands below also work on that Linux machine.

For eligible subscriptions, ACR builds upload the filtered build context and
incur build charges. They do not require a local Docker daemon:

```sh
az acr build --registry "$RPAPER_REGISTRY" --platform linux/amd64 \
  --file deploy/azure/Dockerfile --target web --image rpaper-web:release-1 \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="$RPAPER_SUPABASE_URL" \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$RPAPER_SUPABASE_PUBLIC_KEY" \
  --build-arg NEXT_PUBLIC_SITE_URL="$RPAPER_SITE_URL" .

az acr build --registry "$RPAPER_REGISTRY" --platform linux/amd64 \
  --file deploy/azure/Dockerfile --target worker --image rpaper-worker:release-1 .
```

Alternatively, on a machine with sufficient Docker build resources:

```sh
az acr login --name "$RPAPER_REGISTRY"

docker buildx build --platform linux/amd64 \
  -f deploy/azure/Dockerfile --target web \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="$RPAPER_SUPABASE_URL" \
  --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$RPAPER_SUPABASE_PUBLIC_KEY" \
  --build-arg NEXT_PUBLIC_SITE_URL="$RPAPER_SITE_URL" \
  -t "$RPAPER_REGISTRY.azurecr.io/rpaper-web:release-1" --push .

docker buildx build --platform linux/amd64 \
  -f deploy/azure/Dockerfile --target worker \
  -t "$RPAPER_REGISTRY.azurecr.io/rpaper-worker:release-1" --push .
```

Use a unique release tag for subsequent deployments. The web image includes a
small Python/PyMuPDF environment for upload validation. The worker includes the
full parser and downloads model artifacts at build time. Both run as a non-root
user. `.dockerignore` excludes credentials, local Python environments, and PDFs.
Container builds use Next.js's supported Webpack mode with a bounded compiler
heap; local development and the ordinary `npm run build` keep their defaults.

## Runtime settings

Enter the Supabase server key through Azure's secret settings and reference that
secret in the environment. Never pass it as a build argument, image layer, public
environment variable, command-line literal, or committed file.

| Variable | Web | Worker |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Same as build | Existing Supabase URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Same as build | Not required |
| `NEXT_PUBLIC_SITE_URL` | Final HTTPS origin | Not required |
| `SUPABASE_SECRET_KEY` | Azure secret reference | Azure secret reference |
| `AZURE_STORAGE_QUEUE_URL` | `https://ACCOUNT.queue.core.windows.net` | Same URL |
| `AZURE_DOCLING_QUEUE_NAME` | `docling` | `docling` |
| `AZURE_CLIENT_ID` | Web identity client ID | Worker identity client ID |

The images already set Python paths and `DOCLING_ENABLED=1`. The web image sets
`DOCLING_DISPATCH_MODE=azure-queue`. The worker sets its baked-in model directory.
Do not override these with Mac paths or copy `.env.local` into a container.

In Supabase Auth URL Configuration, set the Site URL to the deployed HTTPS
origin and allow `https://YOUR-HOST/auth/callback?next=/library` and
`https://YOUR-HOST/auth/callback?next=/auth/reset-password`, the redirect URLs
currently used by this app. Keep localhost redirects only if local development
still needs them.

## Delivery and recovery behavior

The API authenticates the caller and verifies document/job ownership before
sending IDs to the queue. It responds with success only after Azure accepts the
message. The worker claims the existing Postgres job with a fresh run ID; live
claims prevent simultaneous processing of the same job. It confirms the final
database status before deleting a delivery. A crash leaves the message hidden
for up to 30 minutes, after which an execution can reclaim the stale database
lease. An active duplicate is deferred by 330 seconds. Repeatedly interrupted
deliveries are quarantined after five receives and the owned attempt is failed
so the user can retry. Inspect and alert on the poison queue; it contains IDs,
not PDFs, for normal application messages.

Supabase job creation and Azure enqueue are not one transaction. If a browser
closes between them, or dispatch is rejected, opening the processing page retries
dispatch. Recovery after an *accepted* dispatch does not require that page to stay
open. A scheduled reconciliation service would be needed to recover never-dispatched
database jobs without a user revisiting; this is not included in this version.

Queue delivery failures retain the message. Confirmed parser failures remain
visible as failed in the library and require a new user retry. Azure job execution
success therefore means the delivery was handled, not necessarily that the PDF
parsed successfully; monitor the database result as well as Azure execution logs.

## Release checks

Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build:azure-worker`.
Build both image targets, then verify these flows on the deployed staging URL:

1. Sign in, sign out, and password recovery return to the deployed origin.
2. Upload a native-text PDF, a scanned PDF, and a table-heavy PDF; verify the
   reader, original PDF, and signed private images.
3. Reject encrypted, empty, oversized, and more-than-16-page PDFs.
4. Dispatch the same job twice and confirm only one version is committed.
5. Stop a worker during processing, close the browser, and confirm queue
   redelivery recovers the stale run without duplicate publication.
6. Verify a different user cannot dispatch or view another user's document.
7. Record Linux parse time, peak memory, queue delay, and cost before raising
   concurrency or admitting broader traffic.

Deploy the worker image first, then the web image. Retain the previous image tags
and web revision for rollback. No schema rollback or document deletion is needed.
Keep the worker compatible with version-1 queue messages while any remain pending.

## References

- [Azure Container Apps jobs](https://learn.microsoft.com/en-us/azure/container-apps/jobs)
- [Event-driven queue jobs](https://learn.microsoft.com/en-us/azure/container-apps/tutorial-event-driven-jobs)
- [Managed identities](https://learn.microsoft.com/en-us/azure/container-apps/managed-identity)
- [Queue SDK and passwordless access](https://learn.microsoft.com/en-us/azure/storage/queues/storage-quickstart-queues-nodejs)
- [Supabase redirects](https://supabase.com/docs/guides/auth/redirect-urls)
- [ACR build command](https://learn.microsoft.com/en-us/cli/azure/acr?view=azure-cli-latest#az-acr-build)
- [ACR free-credit restriction](https://learn.microsoft.com/en-us/azure/container-registry/container-registry-tasks-overview)

## Staging deployment and verification (2026-09-08)

Staging URL: https://rpaper-staging.agreeablewave-eee902f6.centralindia.azurecontainerapps.io

The `rpaper-staging` resource group in Central India contains:

- Container App `rpaper-staging`: the Next.js frontend and API together, 1 CPU /
  2 GiB, HTTPS, zero to one replicas.
- Container Apps job `rpaper-docling`: queue-triggered parser, 4 CPU / 8 GiB,
  zero minimum executions and at most one new execution per polling interval.
- Consumption environment `rpaper-staging-env`.
- Basic registry `rpaperstagefbea2d`, with `rpaper-web` and `rpaper-worker` images
  tagged `staging-20260908-1`.
- Storage account `rpaperstagefbea2d`, with `docling` and `docling-poison` queues.
- Separate managed identities for web and worker registry/queue access.

The existing hosted Supabase database, Auth, and private PDF/artifact Storage
remain in use. No database migrations were applied. The user saved the staging
Auth URL configuration; recovery-link generation confirmed the redirect is
accepted. No recovery email was sent during verification.

Both Linux AMD64 images were built on a temporary Azure Linux VM because ACR
Tasks rejected this free-credit subscription. After pushing the images, the
entire temporary build resource group was deleted and its registry push role
removed. The subscription spending limit remains **On**. Remaining credit and
expiry were not available through these checks. Registry and storage charges
can continue even when application compute scales to zero.

To regenerate private ARM request bodies, provide the metadata fields validated
by `scripts/prepare-azure-config.mjs` and run
`node scripts/prepare-azure-config.mjs PATH_TO_METADATA_JSON`. It reads the
ignored local environment and writes mode-600 files under `tmp/azure-deploy`.
Never commit these files or print their contents.

- Lint, TypeScript, and all 44 unit tests passed.
- Both the ordinary macOS production build and the container-configured standalone
  Webpack build passed on macOS. The standalone worker bundle also passed.
- The Linux ARM64 web preflight image built and validated a synthetic one-page PDF
  as the non-root application user.
- Both complete Linux AMD64 images built and pushed successfully. Web and job
  provisioning succeeded; the public landing page returned HTTP 200.
- A temporary user signed in, accessed the library (200), validated and uploaded
  a synthetic one-page PDF (200), and dispatched it to Azure (202). The event
  scaler started the worker automatically; execution `rpaper-docling-9b4jv`
  succeeded and the database job reached `ready` without an open browser.
- The reader returned 200 and contained the source text. Its schema-2 manifest
  contained two sections and exactly one document version existed. Downloading
  the signed original worked. This fixture had no image assets.
- Unauthenticated dispatch returned 401; an unauthenticated reader request
  redirected to authentication. Repeating the completed dispatch returned 202.
  Sign-out succeeded.
- The temporary test user, document, and all 12 source/output objects were
  removed. The temporary build resource group was independently confirmed absent.

This is a staging smoke test, not full production qualification. Scanned and
table-heavy PDFs, private image rendering, cross-user isolation, simultaneous
duplicates, forced worker termination/redelivery, and sustained performance
remain to be verified on Azure. Browser interaction and recovery email delivery
were not tested. Historical log collection and poison-queue alerts are not yet
configured; the environment currently provides live log streaming only.

## Azure Document Intelligence cutover (2026-09-08)

The selected parser is now Azure Document Intelligence Layout, API `2024-11-30`,
with the formula add-on. The existing `rpaper-docling` job name, queue message
schema, claim/finalization RPCs, document ownership, and v2 reader contract remain
compatible. Previously parsed versions remain readable.

- Document service: `rpaper-ocr-benchmark`, Central India, S0. The benchmark
  resource is reused for application inference.
- Worker image: `rpaperstagefbea2d.azurecr.io/rpaper-worker:azure-layout-20260908-2`.
  Build with Docker target `azure-worker`, not the legacy `worker` target.
- Worker resources: 1 CPU / 2 GiB; event polling every 10 seconds, minimum zero.
- Worker settings: `DOCUMENT_PARSER=azure-layout`,
  `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=https://rpaper-ocr-benchmark-ab4e0.cognitiveservices.azure.com/`.
- Identity: `rpaper-worker-mi` has Cognitive Services User on this document
  service only, in addition to its existing registry and queue permissions.
- Azure keys are not placed in the worker. Node obtains an Entra token using
  managed identity; the PDF crop subprocess receives no cloud credentials.

The worker submits PDF bytes to Azure and polls its same-origin result endpoint
under a bounded deadline. `azure_export.py` converts paragraphs, headings, tables,
figures, and source provenance into the reader manifest. Formula text is retained
as an unverified candidate; inline formulas and mathematical table cells display
crops from the original PDF. Ambiguous placeholder mapping falls back to a source
paragraph image. Azure HTML is not injected into the reader.

The existing SQL RPC writes a historical parser label for compatibility. The
manifest and quality summary atomically record the actual Azure parser; after
publication the worker updates only its own version's `parser_version` label to
`azure-layout-2024-11-30-v2`. A label update failure is logged and does not delete a
successfully published document. No schema migration was needed.

`prepare-azure-config.mjs` accepts `documentParser`, `documentIntelligenceEndpoint`,
and `workerImageTag` in the local deployment metadata. Only the worker ARM body
was applied for this cutover. The live web app settings were not changed.

For rollback, update the worker to image `rpaper-worker:staging-20260908-1`, set
`DOCUMENT_PARSER=docling`, and restore 4 CPU / 8 GiB. Retain the existing identity,
secrets, and queue configuration. Existing Azure-generated documents continue to
use the same reader contract. Do not recreate or reset the hosted database.

The Azure analysis price estimate from the benchmark is $0.016/page including
one formula add-on ($0.16 for a ten-page paper), excluding worker and storage
usage, tax, and subscription-specific discounts. API parsing does not eliminate
queue startup, PDF upload, source-crop upload, or reader-loading latency.

Asset uploads use batches of four and update progress once per batch. Every
in-flight upload settles before failure cleanup, preventing late uploads from
leaving untracked private objects.

### Cutover verification

- TypeScript, ESLint, 48 application tests, and five Azure adapter tests passed.
- The adapter converted all six benchmark PDFs into the existing reader contract.
- The 15-page Attention paper was uploaded through the live authenticated app.
  The Azure worker published exactly one version with the correct parser label;
  its reader returned 200 with source text. The original and all 126 private
  source images downloaded successfully. Unauthenticated dispatch returned 401,
  and unauthenticated reader access redirected to sign-in. Repeating a completed
  dispatch returned 202 without creating another version.
- On a second live run with batched asset saving, the same paper took about
  48.5 seconds from worker claim to ready, versus 115.1 seconds with sequential
  asset saving. Creation-to-ready was about 75.3 seconds, including queue/startup.
  These are individual smoke runs, not controlled latency percentiles.
- The six-page scanned scikit-learn paper reached ready using the deployed Azure
  worker in about 20.8 seconds after claim (50.4 seconds from job creation).
  All three test documents had exactly one version, each labeled Azure Layout.
- The temporary build resource group `rpaper-build-layout-20260908` was deleted
  and independently confirmed absent; its external ACR push role was removed.
  The subscription spending limit remains On.
- The scanned reader returned 200 with source text; the original PDF and all 11
  private source images downloaded successfully. The temporary account, its
  three documents, and all 275 source/output objects were removed and verified.

### Processed-paper navigation cache — 2026-09-08

- Web image: `rpaper-web:navigation-cache-20260908-1`, revision
  `rpaper-staging--0000002`, verified healthy with 100% traffic. Web compute
  remains 4 vCPU / 8 GiB; the Azure OCR worker remains unchanged.
- Next.js browser Router Cache retains visited/prefetched pages for 120 seconds.
  Visible ready-paper links and reader library links fully prefetch their routes.
  This cache is in the browser, not a shared server/CDN cache of private papers;
  every server request still goes through authentication and Supabase policies.
- Upload, publish, unpublish, delete, reprocess and processing completion refresh
  cached pages. Account changes and sign-out also refresh the cache, including
  sign-out in another tab. Existing signed asset URLs outlive the page cache.
- Production Chromium smoke test with one six-page public scikit-learn fixture,
  three reader/library round trips, and six seconds allowed for initial prefetch:
  opening went from 1,332–3,421 ms to 51–139 ms; library return went from
  824–1,334 ms to 50–68 ms. All six updated navigations issued zero RSC requests.
  These are individual warm-cache measurements, not latency percentiles or a
  promise about first loads, expired caches, or container cold starts.
- Live publish/unpublish and cross-tab sign-out regression checks passed without
  browser errors. All 49 unit tests, lint, TypeScript and the production build
  passed. The temporary test account, its document and 12 Storage objects were
  removed. The temporary builder resource group was confirmed absent, and its
  external ACR push permission was removed.

### Google OAuth callback redirect — 2026-09-08

- Before the fix, the live `/auth/callback?next=/library` returned
  `Location: https://0.0.0.0:3000/library`. The callback used the internal
  container request origin after saving the session, explaining why returning
  to the public app revealed an already signed-in session.
- Production callbacks now use the configured `NEXT_PUBLIC_SITE_URL` origin.
  Local development retains the incoming localhost port. Forwarded-host headers
  cannot select the redirect host, and external/backslash/control-character
  `next` destinations fall back to `/library`.
- Only successful code exchanges proceed to the requested page. Missing,
  cancelled or invalid codes return to public sign-in with a retry message.
  Callback responses are private and non-cacheable. Password recovery retains
  its reset-password destination.
- Deployed web image `rpaper-web:auth-redirect-20260908-1`, revision
  `rpaper-staging--0000003`, verified healthy with 100% traffic. Web resources
  remain 4 vCPU / 8 GiB; navigation caching and the OCR worker are preserved.
- All 58 tests, lint, TypeScript and the production build passed. Live checks
  confirmed public-origin redirects for missing, invalid and cancelled codes,
  the visible retry message, and Google OAuth initiation with PKCE and the public
  callback. Google's consent-page response was intercepted in the browser test;
  an interactive Google account sign-in was not automated. Successful code
  exchange and password recovery routing are covered by callback unit tests.

### Compact workspace, notifications and soft deletion — 2026-09-08

- Web image `rpaper-web:workspace-controls-20260908-1`, healthy revision
  `rpaper-staging--0000004`, received 100% traffic. Compute and OCR configuration
  were preserved.
- The library sidebar and mobile drawer were replaced with a top-left logo and
  compact bottom-left profile chip. Long names fade at the chip's right edge;
  the native modal dialog reveals the full name, email and sign-out action.
  The global top-right theme button is circular.
- Sonner 2.0.8 provides bottom-right loading, success, information, warning and
  error notifications. Mobile toasts sit above the profile chip. Uploads,
  deletion, publishing/privacy updates, copying links, reprocessing, processing
  completion, theme/text-size changes and account actions provide feedback.
- DELETE now invokes the existing owner-scoped `request_document_deletion` RPC
  and retains the database row, versions, original PDF and parsed assets. It no
  longer uses an admin client to permanently remove objects or rows. Repeated
  owner deletion returns 204. No database migration was required.
- Reader, processing and public-share page queries exclude `deleted_at` rows.
  Missing-page rendering was verified; Next.js streamed responses can carry
  HTTP 200 even when the rendered result is the missing-page view.
- All 63 unit tests, lint, TypeScript and the Linux production build passed.
  Browser checks covered widths 320–1440, profile focus restoration/Escape,
  full long names, name fading, theme colors, sign-out, upload validation/error
  and success toasts, publishing, and deletion without native browser prompts.
- Live deletion verification used a temporary owner with a saved public
  scikit-learn extraction. The row, parsed version, manifest, original PDF and
  all 11 source images remained after deletion; the library and old reader/
  processing/public links stopped showing the paper. Repeated DELETE returned
  204 and unauthenticated DELETE returned 401.
- `npm run test:workspace` runs the corner/profile regression checks against
  `CHECK_BASE` (default `http://localhost:3008`); `test:sidebar` remains an alias.
  It creates and cleans up its own temporary verification account.

### Queue duplicate backlog fix — 2026-09-08

- Root cause: the processing screen dispatched queued jobs every five seconds,
  while each worker execution consumed only one delivery, including completed
  duplicates. The queue had 67 messages; 28 of the first 32 referenced an already
  completed job. One real job queued for 16 minutes before parsing in 14 seconds.
- An audited cleanup removed 29 messages whose jobs were completed, failed or
  no longer existed. Active deliveries were retained and immediately released.
  The previously waiting real paper then completed successfully in about 45
  seconds after worker claim. Its database/file history was preserved.
- The dispatch API now conditionally reserves the queued job's `heartbeat_at`
  for 120 seconds, scoped by owner/document/job/status. Concurrent callers across
  replicas or restarts share this database lease. Failed Azure sends release
  only their matching reservation; processing worker heartbeats are untouched.
  This uses existing columns and requires no schema migration.
- Browser recovery checks remain every five seconds, but send only after two
  minutes without queued activity or five minutes without processing activity,
  with a two-minute retry interval. Overlapping client polls are suppressed.
- Workers drain up to 100 obsolete deliveries or 60 seconds of cleanup before
  exiting, stopping after one actual paper to retain the existing parser time
  and memory bounds. Unconfirmed work is never acknowledged. One verified
  execution discarded 28 obsolete deliveries instead of starting 28 containers.
- Deployed web and worker images: `queue-dispatch-20260908-1`; web revision
  `rpaper-staging--0000005` was healthy with 100% traffic. Existing CPU/memory and
  event scaling settings remain unchanged.
- All 66 tests, lint, TypeScript, worker bundle and production image builds
  passed. Ten concurrent authenticated dispatch requests produced one visible
  message. A fresh six-page scikit-learn upload queued for 27.987 seconds,
  processed for 12.588 seconds, and completed in 40.575 seconds total. The queue
  returned to zero. These are individual smoke measurements; an idle worker
  still incurs container startup time.
- The finished reader returned 200 with source text, exactly one Azure Layout
  version, and all nine original/image downloads succeeded. The temporary
  account and its 12 stored objects were removed. Temporary queue-repair and
  builder registry permissions were removed after verification.

### Warm queue worker — 2026-09-08

The duplicate fix left a 28–31-second wait on two subsequent real uploads:
each event execution still needed polling and a new container startup. The
`azure-worker` image now supports `AZURE_WORKER_MODE=continuous`. It processes
sequentially and stays alive when empty, polling every two seconds. Errors use
exponential backoff capped at 30 seconds, resetting after a successful delivery.
Idle polls do not log or query Supabase. SIGTERM/SIGINT stop further receives
and allow the current document to finish; queue acknowledgement and the existing
owned database leases remain unchanged.

`prepare-azure-config.mjs` generates a private `warm-worker.json` for Azure Layout:
an ingress-disabled Container App, single revision, min/max replicas both one,
1 vCPU / 2 GiB, existing worker identity and secret reference, and a 600-second
termination grace period. Set `warmWorkerName` in local deployment metadata to
generate the old job as a manual fallback. Deploy the warm app and check its logs
before switching the old job from Event to Manual. Never apply the generated web
configuration to an existing web app without checking its current resource sizing.

The new warm app is `rpaper-parser`; `rpaper-docling` is retained as the manual
one-shot fallback. Rollback means restoring the old job's event trigger and
deactivating the warm app revision. A forced termination that outlasts the grace
period retains its unacknowledged message for the existing lease/redelivery path.
One warm worker eliminates routine startup delay, but uploads can still wait
behind another document or during a platform restart.

Keeping a replica warm has an ongoing compute cost. Central India retail rates
checked on 2026-09-08 are $0.000003/vCPU-second idle, $0.000024/vCPU-second active,
and $0.000003/GiB-second memory. At 1 vCPU / 2 GiB this is about $0.78/day if
Azure classifies it as idle, or $2.59/day if always active, before monthly free
grants. Frequent polling can affect the idle classification. These are worker
compute estimates; OCR, storage operations, logs, registry, and web are separate.
See [Azure billing](https://learn.microsoft.com/en-us/azure/container-apps/billing)
and the [Azure retail prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices).

Live verification of the warm worker (`warm-worker-20260908-1`) measured queue
waits of 7.484 and 4.822 seconds, followed by 14.041 and 14.406 seconds of
processing for two fresh six-page PDFs. Both readers, single committed versions,
and original/private images passed. The replica remained running without a
restart. The temporary verification account, files and build resources were
removed.

### Cached first-page previews

The library now uses an existing `preview-v1.png` in each owner's document
directory. The worker renders only page one at at most 168 × 224 pixels using
PyMuPDF, alongside the existing OCR request, then stores it once. Rendering has
a ten-second timeout and a 128-KiB output limit. Preview failure does not fail
document parsing. No schema changes or extra library-page queries are required.

The thumbnail endpoint authenticates the session, checks document ownership and
soft deletion, and downloads only the small image. It never downloads or renders
a PDF. Images load lazily at low priority with asynchronous decoding and fixed
layout dimensions. They bypass Next.js's public image optimizer and use private
browser caching for one day, varying by session cookie. Missing images use the
existing placeholder and are not cached. The private bucket remains private.

Existing readable papers received previews independently of OCR. Initial
backfill images were approximately 11–25 KiB, with local render times of
128–190 ms. Documents changed or deleted during backfill were skipped after a
state recheck; source files, parsed versions and document metadata were retained.

Deployed web/worker image `pdf-preview-20260908-2`, web revision
`rpaper-staging--0000006` and warm worker revision `rpaper-parser--0000001`.
The manual fallback also uses the updated worker image. Live verification of a
new six-page upload measured 7.936 seconds queued and 13.845 seconds processing.
Its preview was generated automatically: 168 × 218 pixels, 9,696 bytes. A second
library navigation used the browser cache (transfer size zero); the library
issued no PDF requests. Desktop and mobile screenshots, authenticated/foreign
access checks, the reader and all private assets passed. All 74 JavaScript tests,
the first-page pixel/bounds Python test, lint, TypeScript and Linux builds passed.

### Parsing motion — 2026-09-09

GSAP 3.15.0 powers a layered paper illustration on the processing screen: a
quiet queued state, scanning and floating structure/equation cards during
extraction, staggered content assembly, and a check seal only on completion.
Failed jobs show a static paused state with the existing retry action. The
queued heading now describes waiting instead of implying validation has begun.
The accessible progress bar always uses the actual job percentage.

GSAP is dynamically imported by the illustration after the processing screen
mounts. No animation dependency is imported by the library or reader. Motion
uses scoped GSAP timelines with cleanup on phase changes and unmount; it pauses
when the tab is hidden and reverts to a static illustration under reduced
motion. A missing animation chunk leaves parsing and navigation operational.
No per-frame React state, PDF rendering, video or animation plugins are used.

Local browser verification covers queued/scan/compose/ready/paused states,
real percentage display, reduced motion, hidden-tab pausing, desktop/mobile
layout and back navigation. These state checks use a temporary owned job that
is not sent to the OCR queue.

Deployed web image `parsing-motion-20260909-1`, revision
`rpaper-staging--0000007`. The same checks passed on the live Azure site, with
no page errors. The GSAP chunk is 19,828 bytes gzip; network checks confirmed it
was not requested on the initial library visit and was requested on entering
the processing screen. All 74 existing tests, lint, TypeScript and the Linux
production build passed. Worker image, compute settings and queue behavior
remain as deployed for the preview release.

### Circular parsing progress — 2026-09-09

Replaced the floating paper/cards with a circular progress meter. The stationary
outer arc and central percentage use the processing job's actual percentage;
the fine inner arc indicates ongoing activity. Content regions in the central
page diagram are detected in sequence during extraction and aligned during
assembly. The completed state shows a check, and failures stop the activity.
Removed the duplicate horizontal bar and condensed the stage list into Inspect,
Extract and Assemble. OCR/table stages map to extraction rather than validation.

Implementation references were retrieved with Context7 MCP from
`/websites/gsap_v3`: scoped timelines, SVG attribute tweens,
[matchMedia](https://gsap.com/docs/v3/GSAP/gsap.matchMedia()/) for reduced motion,
and context cleanup. The SVG renders accurate progress without GSAP; motion is
optional and paused in hidden tabs. The existing lazy GSAP import is retained.
Local browser checks verified all five states, a live fixture update from 20%
to 40% and its precise ring offset, reduced motion, hidden-tab pausing, mobile
layout and navigation. No OCR work is dispatched by these visual checks.

### Email signup names and feedback — 2026-09-09

Email signup now requires first and last name and sends `first_name`,
`last_name` and `full_name` through Supabase Auth metadata. The existing profile
creation trigger uses `full_name`. Google signup continues to use Google's
identity details.

A small global Feedback control sits above the bottom-left profile. Hover,
click or keyboard focus reveals the form; Escape closes it while retaining a
local draft. The form chunk loads only on first opening and does not add an
auth/profile request to initial navigation. Signed-in identity is verified on
the server; guests provide their name and email. Sonner reports save success
and errors. A seven-second invitation appears after a minute and then at
five-minute intervals, at most three times per browser tab session. Any
interaction stops the invitations. The pulse respects reduced motion.

Migration `20260908190603_collect_feedback.sql` creates `public.feedback` with
`name`, `email`, `feedback`, UUID submission ID, timestamp and optional user ID.
The table has RLS enabled and no visitor grants or policies. The server-only
`submit_feedback` invoker function handles duplicate retries and serializes a
30-second sender cooldown. Account deletion clears the reference while keeping
the feedback. Project administrators can read responses in Supabase Table
Editor. Feedback is not emailed.

Validation: 81 tests, lint, TypeScript, production Linux build, and local
Playwright signup metadata/guest/account/hover/mobile/reminder checks passed.
Database transaction tests verified duplicate handling, cooldown, conflict
handling, and private table/function permissions. The existing 19 document
rows (including the temporary test paper) were unchanged by the migration.
Supabase CLI advisors could not connect over this machine's IPv6 network;
explicit database privilege, RLS and function search-path checks passed through
the project's existing authenticated remote connection.

Released web image `feedback-20260909-1` (digest
`sha256:4d5c40cd924db6ceb9a209365592fe74ca55e72a2fbd3b742be92d224a44e75a`),
healthy revision `rpaper-staging--0000008` with 100% traffic. The release also
includes the circular parsing meter and theme-aware slash favicon; the live
icon URL is `/icon.svg?5be91c798dfcf235`. Live browser checks passed for signup
metadata (intercepted before sending verification mail), guest and signed-in
feedback, verified sender identity, retries, cooldown, private access, mobile
layout and the reminder lifecycle. All five circular parsing states, exact
progress updates, reduced motion, hidden-tab pause and library navigation
passed on the deployed site without browser errors.

Four temporary feedback rows were removed with exact ID and test-email guards.
The temporary account, paper and source file were removed after verification.
The builder's temporary ACR role was revoked and its resource group deletion
requested. Web compute remains 4 vCPU / 8 GiB; the parser deployment is unchanged.

### Custom domain — 2026-09-09

`randomwebsite.website` uses Namecheap BasicDNS. The apex A record points to
`4.188.92.247`, and the `asuid` TXT record contains the Azure Container App's
public domain verification ID. Namecheap contact verification was completed,
and the previous redirect record was removed. Azure's free managed certificate
`mc-rpaper-staging-randomwebsite-we-7697` was issued and bound with SNI. The
custom domain returns HTTPS 200 with normal certificate validation.

The callback reads `SITE_URL` at runtime and accepts forwarded hosts only when
they match the configured public origin or `AUTH_REDIRECT_ORIGINS`. The existing
Azure origin remains allowlisted so authentication cookies and the callback's
final redirect stay on the same host. Public build settings use the custom
domain. The runtime origin avoids requiring a new build for future primary
origin changes. Untrusted forwarded hosts fall back to the configured origin.

The user added the custom-domain Supabase callback URLs for `/library` and
`/auth/reset-password`. Admin-generated recovery links (no email sent) verified
that both exact redirect URLs are accepted. No database, OCR or worker changes
are needed for the domain. Tests now total 84, including custom, legacy and
untrusted callback host cases; lint and TypeScript passed.

Deployed image `custom-domain-20260909-1`, digest
`sha256:4b03ec4e87726f989881730d2c677bbf0bc2dfd6501cdc9c369463abfb649fc7`,
healthy revision `rpaper-staging--0000009`, 100% traffic. Web compute remains
4 vCPU / 8 GiB. Live checks verified HTTPS, HTTP-to-HTTPS redirection, callback
error handling on both trusted domains, an authenticated library request,
and Google's PKCE authorization initiation with the new callback URL.
Interactive Google consent was not automated. No browser page errors occurred.

The apex callback allowlist was verified during this rollout. The primary Site
URL was subsequently set to the Paperflow subdomain described below. The
temporary builder's ACR role was revoked and its resource group was deleted.
The temporary domain test account was deleted and its absence verified.

### Paperflow subdomain — 2026-09-09

The primary app address is now `https://paperflow.randomwebsite.website`.
Namecheap's `paperflow` CNAME points directly to the generated Azure app FQDN;
`asuid.paperflow` contains the same app verification code. Managed certificate
`mc-rpaper-staging-paperflow-random-4292` was issued and bound with SNI.
Revision `rpaper-staging--0000010` applies the new runtime `SITE_URL` using the
existing `custom-domain-20260909-1` image. The apex and original Azure origins
remain explicitly allowlisted, and their certificate/hostname bindings are
retained in the deployment metadata. No image build or extra compute was needed.

Live tests verified HTTPS with normal certificate validation, HTTP-to-HTTPS
redirects, callback destinations across all three origins, an authenticated
library session, and Google PKCE initiation. The test process pinned only the
new hostname to its independently verified Azure IP because the Mac system
resolver retained the previous Namecheap parking IP. Both authoritative
Namecheap DNS servers and public resolvers returned the new CNAME. No browser
page errors occurred; interactive Google consent was not automated.

The owner saved the Supabase URL configuration, and final admin-generated
recovery links (no emails sent) verified all three settings:

- Default Site URL: `https://paperflow.randomwebsite.website`.
- Callback: `https://paperflow.randomwebsite.website/auth/callback?next=/library`.
- Recovery callback: `https://paperflow.randomwebsite.website/auth/callback?next=/auth/reset-password`.

The final live checks passed again after that update. Revision
`rpaper-staging--0000010` is healthy with 100% traffic. The Mac system resolver
still retained the old parking address during verification, so the test process
used the published Azure IP while retaining normal HTTPS certificate validation.


Follow-up DNS diagnosis: both authoritative Namecheap servers answer an A query
for `paperflow.randomwebsite.website` with `162.255.119.93` while answering a
CNAME query for the same owner with the correct Azure FQDN. This is an active
conflicting record, not just stale recursive DNS. The earlier checks verified
the CNAME and the Azure endpoint but missed the conflicting authoritative A
answer. The owner removed the conflicting Namecheap URL Redirect row while
retaining the Azure A/CNAME and verification TXT records.
Azure revision 0000010 remains healthy and its HTTPS certificate validates.


DNS resolution verified after redirect deletion (2026-09-09): both authoritative
Namecheap servers now return the Azure CNAME for subdomain A and CNAME queries.
Cloudflare (1.1.1.1) and Google (8.8.8.8) recursive A queries resolve through that
CNAME to `4.188.92.247`. Normal HTTPS, without a resolver override, returns HTTP
200 with valid TLS and the Paperflow page title. HTTP redirects to HTTPS (301).
The apex A record remains `4.188.92.247`, and `asuid.paperflow` is retained.

### Queue-based parser scaling — 2026-09-09

The parser now keeps one warm replica and scales up to three total replicas on
queue demand. Each replica retains 1 vCPU / 2 GiB and processes one document at
a time. Revision `rpaper-parser--0000002` uses the existing
`pdf-preview-20260908-2` worker image; the website, OCR adapter, database schema,
managed identities, secret references, and 600-second shutdown grace are unchanged.
The fallback `rpaper-docling` job remains Manual.

The `docling-queue` custom rule uses `azure-queue`, the worker's existing managed
identity, `queueLength=1`, and `queueLengthStrategy=all`. Counting invisible
messages includes work currently being processed. The polling interval is ten
seconds; the minimum is one and maximum is three. Azure's scale-down stabilization
window is approximately five minutes, so extra idle replicas are not removed
immediately. Maximum replicas bounds steady-state worker count, not total costs
or temporary platform-maintenance overlap. Sources:
[Azure scaling](https://learn.microsoft.com/en-us/azure/container-apps/scale-app),
[KEDA queue metric](https://keda.sh/docs/2.18/scalers/azure-storage-queue/).

`scripts/prepare-azure-config.mjs` now preserves this scaling policy in generated
warm-worker deployments. The live update patched only the existing parser
template, retaining its container configuration. Do not apply the generated web
artifact to the deployed website: its original starter sizing is different.
To stop burst scaling while retaining the warm parser:

```sh
az containerapp update -g rpaper-staging -n rpaper-parser --min-replicas 1 --max-replicas 1
```

A bounded live test submitted nine copies of the public six-page scikit-learn
PDF concurrently through the normal authenticated validation, Storage upload,
enqueue and HTTP dispatch flow, using three temporary accounts. All nine uploads
were accepted in 4.553–5.713 seconds each. Azure grew from one to three replicas;
database job timestamps independently showed three concurrent processing jobs.
The last paper completed 72.844 seconds after the upload burst began. All nine
jobs were ready, each had exactly one committed version, and all nine authenticated
reader requests returned 200. This is a single small burst, not a sustained
throughput limit, p95 result, or guarantee for other PDF types. Targeted worker,
dispatch and shutdown tests passed (20 tests), as did the config script's lint.
Local test evidence and before/after configuration snapshots are under ignored
`tmp/azure-autoscale/`.

Scale-down was independently verified: the queue was empty, one worker was
Running, and the other two were NotRunning with exit code 0. The initial test
monitor counted all replica records, including stopped replicas retained in
Azure's response, and therefore reported a scale-down timeout. The test helper
now filters Running replicas; the original report retains that timeout alongside
the independent verification. All three temporary accounts and their nine
documents were removed, along with 117 test Storage objects; account absence
and zero remaining test documents were verified.

The owner's Azure portal screenshot showed **$199.92 remaining, expiring in 16
days** on 2026-09-09. This is a screenshot observation, not a live billing API
balance: the attempted Consumption balances endpoint was unavailable for this
subscription. The subscription API independently confirmed FreeTrial status and
spending limit On. No billing upgrade or spending-limit change was made.
The test analyzed 54 pages; at the previously checked $0.016/page estimate this
is about $0.864 in OCR usage, plus compute and storage. Actual billed usage may
appear later and can differ. Extra replicas consume allowance/credits while
active and while waiting to scale down.

### OrbKit parsing animation — 2026-09-09

The processing screen uses OrbKit's Hydrogen (SHDR-11) inside the existing
authoritative circular progress meter. Waiting, extraction and assembly map to
the orb's idle, thinking and speaking presets with subdued motion. Completion
and failure unmount the WebGL canvas and retain the existing success/retry UI.
The animation does not drive progress or change document processing.

The MIT-licensed runtime and Hydrogen shader are vendored from
`zzzzshawn/orbkit` commit `35e42484560fd35e8502703ba58fa99541d8c686`;
their license is included beside the source and at `/licenses/orbkit.txt`.
No restricted shader variants or new npm dependencies are included.

A client-only dynamic import isolates the orb from library/reader bundles.
The shader draw ceiling is 30 fps with DPR capped at one, and the upstream
adaptive resolution accounts for that ceiling. Hidden tabs and reduced-motion
preferences pause drawing; offscreen rendering is paused by the runtime. A
static gradient remains when WebGL is unavailable, and an error boundary keeps
the progress UI working if the optional orb chunk fails to load.

Local browser verification covered both themes, mobile overflow, hidden tabs,
live reduced-motion changes and resumption, unchanged canvas identity on progress
updates, disposal on completion, absent WebGL, and a blocked orb chunk. The test
observed 26 shader draws in one second under software rendering; that is a bounded
test observation, not a hardware-wide performance guarantee. Lint, type checking,
84 app tests and the production build passed. Local preview evidence is under
ignored `tmp/orbkit-preview/`.

Deployed web image `orbkit-20260909-1`, digest
`sha256:acd6ef2de40a304c3d0696fb693d197b6277b53161e5024f17da71ede87604c6`,
as healthy revision `rpaper-staging--0000011`. Live browser checks at
`paperflow.randomwebsite.website` confirmed that the library does not load the
orb chunk, the processing demo draws it in both themes without mobile overflow,
and completion disposes the canvas. No browser page errors occurred. The
isolated temporary demo account/document/job was deleted and absence verified;
this verification sent no messages to the OCR queue. The deployed MIT notice
matched the source. The web app's other configuration and the entire parser
template were independently compared against pre-deployment snapshots.
The temporary builder's ACR push role was revoked and its VM, disk and networking
resources were removed; the build resource-group inventory was verified empty
after requesting deletion. The temporary local preview server was stopped.

## Nimbus parsing visual — 2026-09-09

- Installed OrbKit Nimbus (SHDR-21) with the requested
  `bunx shadcn@latest add zzzzshawn/orbkit/shdr-21` command in a temporary
  staging directory, then integrated it with the existing MIT runtime and its
  frame limiter. No global shadcn styling or package changes were introduced.
- The parsing visual now has a larger orb and a single thin progress ring.
  Percentages and phase captions remain available through the progress bar's
  accessible name/value, with no visible text inside the ring.
- Status copy below uses a staggered 650 ms opacity/translateY entrance when
  its message changes. Routine percentage updates do not restart the text or
  recreate the canvas. The live region remains mounted for announcements.
- Preserved lazy loading, 30 fps ceiling, DPR <= 1, hidden/offscreen pause,
  reduced-motion handling, static fallback, and terminal-state canvas disposal.
- Web image: `rpaperstagefbea2d.azurecr.io/rpaper-web:nimbus-20260909-1`.
- Image digest: `sha256:abef81beab832d56ce8bd3c0fe48f5ab565cd7d05cd4fbd6aa55a59ee9ad26ce`.
- Revision: `rpaper-staging--0000012`, healthy and serving 100% traffic.
  Before/after comparison confirms only the web image changed; web settings,
  identity, and parser template/configuration were preserved.
- Validation: lint, TypeScript, local production build and Azure container build
  passed. Local WebGL browser checks verified the frame ceiling, visibility,
  reduced-motion toggling, canvas continuity/disposal and fallback. The live
  processing demo passed in desktop light and mobile dark themes, with no
  overflow or browser errors. Live CSS keyframes and reduced-motion disabling
  were checked; the Nimbus chunk was absent from the library's initial load.
- Live verification used a private, confirmed test account and a demo-only
  document/job, without uploading a PDF or dispatching an OCR queue message.
  The session was signed out and the account/document were deleted and checked.
- Cleanup verified: the temporary builder's registry push role was removed,
  its resource inventory is empty, and `az group exists` returns `false` for
  `rpaper-build-nimbus-20260909`.
