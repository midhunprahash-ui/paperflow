# Rpaper adaptive parser worker

The controller validates and converts uploads, then runs MinerU 3.4 on a Modal
L4 GPU. GROBID repairs scholarly metadata and references in parallel. If MinerU
fails, the job falls back to Docling 2.67 on a T4 GPU. The normalized manifest,
original figure crops, parser provenance, quality checks, and assets are committed
atomically through a private PostgreSQL function.

## Configure

Create a Modal secret named `rpaper-worker-secrets` containing:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_DB_URL` (the transaction-pooler connection string)
- `WORKER_CALLBACK_SECRET`

Keep the values out of shell history and chat. Copy the committed template to
the ignored local file, fill it in with values from the Supabase Dashboard, and
generate a callback secret locally:

```bash
cp .env.modal.example .env.modal.local
chmod 600 .env.modal.local
openssl rand -hex 32
```

- Get `SUPABASE_SECRET_KEY` from **Project Settings → API Keys**. Use a secret
  key, never a publishable key.
- Get `SUPABASE_DB_URL` from **Connect → Transaction pooler** and keep
  `sslmode=require` in the URL. If the database password contains reserved URL
  characters such as `@`, percent-encode the password before saving the URL.
- Paste the generated random value into `WORKER_CALLBACK_SECRET`.

Create the encrypted Modal secret without placing values on the command line:

```bash
modal secret create rpaper-worker-secrets --from-dotenv .env.modal.local
```

Create a Modal Proxy Token, deploy with `modal deploy modal_app.py`, and copy the endpoint plus proxy token pair into the Vercel environment. Set a Modal workspace usage budget before accepting uploads. The adaptive worker uses an L4 for MinerU and a T4 only when Docling fallback is required.

## Deploy

```bash
cd worker
python3.12 -m venv .venv
. .venv/bin/activate
pip install -e .
modal deploy modal_app.py
```
