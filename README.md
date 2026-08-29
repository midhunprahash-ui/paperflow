# Rpaper

Rpaper turns PDF and DOCX research papers into clean, responsive reading pages while preserving formulas, tables, figures, references, and the original source.

## Architecture

- **Web:** Next.js 16, React 19, TypeScript, KaTeX; deploy to Vercel Hobby.
- **Data:** Supabase Auth, Postgres, RLS, RPC, Realtime, and private Storage in Mumbai.
- **Parser:** Docling and LibreOffice in a scale-to-zero Modal T4 worker.

The browser uploads directly to an owner-scoped private Storage path. An atomic RPC creates the processing job, Vercel dispatches only IDs to Modal, and the worker writes a versioned manifest and assets back to Supabase. Vercel never proxies document bodies or runs document extraction.

## Local web setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Without credentials the app intentionally runs in demo mode, including the sample library, staged processing animation, and ebook reader.

## Supabase setup

1. Create a Free project in `ap-south-1` (Mumbai).
2. Enable Google Auth and email/password confirmation.
3. Add local and Vercel callback URLs to the Auth redirect allowlist.
4. Link the CLI and apply the migration:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
npx supabase gen types typescript --linked > src/lib/supabase/database.generated.ts
```

The migration creates the schema, targeted indexes, ownership constraints, RLS policies, private Storage bucket, user RPCs, worker-only transaction functions, and Realtime publication.

## Modal worker setup

Read [worker/README.md](worker/README.md). Before enabling uploads:

1. Create the worker secret and Proxy Token.
2. Set the Modal workspace usage budget to `$25` so it remains inside the included `$30` monthly credit.
3. Deploy the worker and add its URL plus proxy credentials to Vercel.

## Verification

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
python3 -m compileall worker
```

Run database tests against local Supabase with `npx supabase test db`. The web app accepts a maximum of 25 MB, 100 pages, five retained documents per user, and one active parser job per document.

## Security boundaries

- Supabase Auth UUID is the sole canonical `owner_id`; application ownership IDs are never regenerated.
- User tables and Storage objects enforce ownership through RLS.
- Extracted content is rendered as a typed document tree, never as source-controlled HTML.
- KaTeX runs with `trust: false` and strict parsing; unknown URLs are rejected.
- Modal requires both Proxy Token authentication and an HMAC timestamped request.
- Supabase secret keys, database URLs, Modal credentials, and callback secrets remain server-only.
