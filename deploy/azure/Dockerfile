# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS node-base
FROM node-base AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS worker-build
COPY src ./src
COPY scripts/azure-worker.ts scripts/build-azure-worker.mjs ./scripts/
RUN npm run build:azure-worker

FROM dependencies AS web-build
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_TELEMETRY_DISABLED=1 RPAPER_CONTAINER_BUILD=1
RUN test -n "$NEXT_PUBLIC_SUPABASE_URL" && test -n "$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" && test -n "$NEXT_PUBLIC_SITE_URL"
# Bound the compiler heap on small build machines; local development keeps Turbopack.
RUN NODE_OPTIONS=--max-old-space-size=1536 npm run build -- --webpack

FROM python:3.12-slim-bookworm AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=node-base /usr/local/bin/node /usr/local/bin/node
RUN useradd --uid 10001 --create-home app
WORKDIR /app
ENV NODE_ENV=production DOCLING_ENABLED=1 \
    DOCLING_PYTHON=/usr/local/bin/python DOCLING_SCRIPT=/app/docling-lab/app_parse.py
RUN mkdir -p /app/tmp && chown -R app:app /app

# Preflight requires only PyMuPDF; inference packages stay in the worker image.
FROM runtime AS web-runtime
RUN pip install --no-cache-dir pymupdf==1.28.2
COPY --chown=app:app docling-lab/app_parse.py docling-lab/parse_pdf.py docling-lab/pdf_thumbnail.py ./docling-lab/

FROM web-runtime AS web
COPY --from=web-build --chown=app:app /app/.next/standalone ./
COPY --from=web-build --chown=app:app /app/.next/static ./.next/static
COPY --from=web-build --chown=app:app /app/public ./public
ENV PORT=3000 HOSTNAME=0.0.0.0 DOCLING_DISPATCH_MODE=azure-queue
USER app
EXPOSE 3000
CMD ["node", "server.js"]

FROM runtime AS worker
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/*
COPY docling-lab/requirements.txt /tmp/docling-requirements.txt
RUN pip install --no-cache-dir torch==2.13.0 torchvision==0.28.0 --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r /tmp/docling-requirements.txt
COPY deploy/azure/download_models.py /tmp/download_models.py
RUN python /tmp/download_models.py
ENV DOCLING_ARTIFACTS_PATH=/opt/docling-models
COPY --chown=app:app docling-lab/*.py src/lib/formula-heading-rules.json ./docling-lab/
COPY --from=worker-build --chown=app:app /app/dist/azure-worker.cjs ./azure-worker.cjs
USER app
CMD ["node", "azure-worker.cjs"]

# Hosted Azure inference: only PDF validation/cropping runs in this image.
FROM web-runtime AS azure-worker
COPY --chown=app:app docling-lab/azure_export.py docling-lab/azure_presentation.py docling-lab/native_pdf.py docling-lab/inline.py ./docling-lab/
COPY --chown=app:app src/lib/formula-heading-rules.json ./docling-lab/
COPY --from=worker-build --chown=app:app /app/dist/azure-worker.cjs ./azure-worker.cjs
ENV DOCUMENT_PARSER=azure-layout AZURE_LAYOUT_SCRIPT=/app/docling-lab/azure_export.py
USER app
CMD ["node", "azure-worker.cjs"]
