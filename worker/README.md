# Rpaper parser worker

The worker runs Docling and LibreOffice in an isolated Modal T4 container. It downloads only owner-scoped source objects, writes the normalized manifest and assets back to private Supabase Storage, and updates job state through private PostgreSQL functions.

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
  `sslmode=require` in the URL.
- Paste the generated random value into `WORKER_CALLBACK_SECRET`.

Create the encrypted Modal secret without placing values on the command line:

```bash
modal secret create rpaper-worker-secrets --from-dotenv .env.modal.local
```

Create a Modal Proxy Token, deploy with `modal deploy modal_app.py`, and copy the endpoint plus proxy token pair into the Vercel environment. Set the Modal workspace usage budget to `$25` before accepting uploads.

## Deploy

```bash
cd worker
python3.12 -m venv .venv
. .venv/bin/activate
pip install -e .
modal deploy modal_app.py
```
