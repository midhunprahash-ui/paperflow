# paperflow frontend review — 2026-09-06

The library now provides instant title/author search, readiness filters, sorting,
list/grid views and a compact sidebar. The reader provides a mobile contents menu,
active section indicators, adjustable text size and light/dark themes. App branding
and page titles use lowercase **paperflow**. Existing saved theme preferences migrate
through a read fallback; infrastructure IDs and account data retain their identities.

## Performance changes

- Public home/sample/shared-paper routes no longer make an unnecessary Auth call
  in the proxy. Private routes verify JWT claims with the Supabase SDK; database
  and Storage access still enforce RLS. Write APIs retain their existing checks.
- Request-scoped React caching reuses the server Supabase client without sharing
  private document data across users.
- Manifest download replaces sign-then-download. Images and original PDFs are
  signed together in parallel batches, eliminating sequential network calls.
- Route loading boundaries immediately stream loading feedback. Library searching
  and filtering happen locally, with deferred rendering for responsive typing.
- Paper content and math rendering stay server-side; small reader controls hydrate.
  KaTeX styles are scoped to reader imports, images below the fold load lazily, and
  scroll progress uses native scroll timelines with a frame-coalesced fallback.

## Measurements

Three warm HTTP requests per route, same local Mac and hosted Supabase fixture;
medians below measure complete HTML response receipt, not visual readiness.

| Route | Before, dev | After, dev | After, optimized local build |
| --- | ---: | ---: | ---: |
| Home | 918 ms | 23 ms | 7 ms |
| Library | 1,038 ms | 317 ms | 249 ms |
| Six-page reader | 3,406 ms | 1,175 ms | 907 ms |

After the changes, development first-byte medians were 34 ms for the library and
25 ms for the reader because loading UI can stream before content completes.
These are small local samples; network variance, cold starts, larger collections
and image transfers affect actual experience. They are not production Core Web
Vitals measurements. Chrome DevTools MCP was unavailable; checks used local HTTP
requests and isolated headless Chromium sessions.

## Verification

- 31 unit/contract tests: reader hierarchy/math/table fidelity, library search and
  sorting, batched asset signing and ownership rejection, verified auth routing,
  refresh cookie propagation, and existing upload/processing contracts.
- Six Playwright tests across desktop and mobile: sample navigation, auth guard,
  invalid credentials, lowercase branding, contents links, text size and persistent
  theme changes.
- Authenticated hosted fixture: desktop 1440px and mobile 390px preserved all 137
  source blocks and 19 outline entries; no page errors or horizontal overflow.
- All 13 rendered source images decoded successfully. Light/dark reader, library
  and landing-page screenshots reviewed. Original PDF remains accessible.
- Lint, TypeScript and optimized Docling app build pass.

The temporary test account and its Storage files are removed after verification.
Existing user papers are preserved. No parser algorithm or extraction claims were
changed by this frontend work; source-image math fallbacks retain the limitations
documented in the Docling lab report.

## References consulted through Context7

- [Next.js navigation, prefetching and loading feedback](https://github.com/vercel/next.js/blob/canary/docs/01-app/01-getting-started/04-linking-and-navigating.mdx)
- [Supabase verified claims and authentication methods](https://github.com/supabase/supabase/blob/master/apps/docs/content/_partials/auth_methods.mdx)
- [Next.js request memoization and caching](https://github.com/vercel/next.js/blob/canary/docs/01-app/02-guides/caching-without-cache-components.mdx)

Installed Next.js 16.3.3 documentation was also checked before implementation.
