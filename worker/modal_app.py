from __future__ import annotations

import hashlib
import hmac
import json
import os
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.parse import quote

import modal
from fastapi import Request


APP_NAME = "rpaper-parser"
BUCKET = "research-documents"

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("libreoffice", "poppler-utils", "tesseract-ocr", "clamav")
    .uv_pip_install(
        "docling==2.67.0",
        "fastapi==0.123.10",
        "pillow==11.3.0",
        "psycopg[binary]==3.3.2",
        "requests==2.32.5",
    )
    .add_local_python_source("normalizer")
)

app = modal.App(APP_NAME)
worker_secret = modal.Secret.from_name(
    "rpaper-worker-secrets",
    required_keys=[
        "SUPABASE_URL",
        "SUPABASE_SECRET_KEY",
        "SUPABASE_DB_URL",
        "WORKER_CALLBACK_SECRET",
    ],
)


def _database_call(function_name: str, *arguments):
    import psycopg

    placeholders = ", ".join(["%s"] * len(arguments))
    with psycopg.connect(os.environ["SUPABASE_DB_URL"], autocommit=True) as connection:
        with connection.cursor() as cursor:
            cursor.execute(f"select private.{function_name}({placeholders})", arguments)
            row = cursor.fetchone()
            return row[0] if row else None


def _storage_headers(content_type: str | None = None) -> dict[str, str]:
    key = os.environ["SUPABASE_SECRET_KEY"]
    headers = {"apikey": key, "authorization": f"Bearer {key}"}
    if content_type:
        headers["content-type"] = content_type
        headers["x-upsert"] = "true"
    return headers


def _storage_download(path: str) -> bytes:
    import requests

    url = f"{os.environ['SUPABASE_URL']}/storage/v1/object/authenticated/{BUCKET}/{quote(path, safe='/')}"
    response = requests.get(url, headers=_storage_headers(), timeout=120)
    response.raise_for_status()
    return response.content


def _storage_upload(local_path: Path, storage_path: str, content_type: str) -> None:
    import requests

    url = f"{os.environ['SUPABASE_URL']}/storage/v1/object/{BUCKET}/{quote(storage_path, safe='/')}"
    with local_path.open("rb") as stream:
        response = requests.post(url, headers=_storage_headers(content_type), data=stream, timeout=180)
    response.raise_for_status()


def _job_context(job_id: int, document_id: int) -> dict:
    import psycopg

    with psycopg.connect(os.environ["SUPABASE_DB_URL"]) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                select d.owner_id::text, d.document_ref, d.source_filename, d.source_type,
                       d.source_path, coalesce(max(v.version_number), 0) + 1
                from public.documents d
                join public.processing_jobs j on j.document_id = d.id and j.id = %s
                left join public.document_versions v on v.document_id = d.id
                where d.id = %s and d.deleted_at is null
                group by d.owner_id, d.document_ref, d.source_filename, d.source_type, d.source_path
                """,
                (job_id, document_id),
            )
            row = cursor.fetchone()
            if not row:
                raise ValueError("Document job does not exist")
            return dict(zip(("owner_id", "document_ref", "filename", "source_type", "source_path", "version_number"), row))


@app.function(
    image=image,
    gpu="T4",
    secrets=[worker_secret],
    max_containers=1,
    min_containers=0,
    timeout=900,
    retries=1,
)
def process_document(document_id: int, job_id: int) -> None:
    from docling.datamodel.accelerator_options import AcceleratorDevice, AcceleratorOptions
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions, TableFormerMode
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from normalizer import normalize_document

    call_id = modal.current_function_call_id()
    try:
        context = _job_context(job_id, document_id)
        _database_call("mark_job_started", job_id, call_id)
        with tempfile.TemporaryDirectory(prefix="rpaper-") as temp_dir:
            temp = Path(temp_dir)
            source = temp / f"source.{context['source_type']}"
            source.write_bytes(_storage_download(context["source_path"]))
            conversion_source = source

            subprocess.run(["clamscan", "--no-summary", str(source)], capture_output=True, timeout=120, check=False)
            _database_call("update_job_progress", job_id, "layout", 18)

            if context["source_type"] == "docx":
                subprocess.run(
                    ["libreoffice", "--headless", "--convert-to", "pdf", "--outdir", str(temp), str(source)],
                    capture_output=True,
                    timeout=180,
                    check=True,
                )
                conversion_source = temp / "source.pdf"
                if not conversion_source.exists():
                    raise ValueError("DOCX conversion did not produce a PDF")

            options = PdfPipelineOptions()
            options.do_ocr = True
            options.do_table_structure = True
            options.table_structure_options.mode = TableFormerMode.ACCURATE
            options.do_formula_enrichment = True
            options.generate_picture_images = True
            options.generate_page_images = True
            options.images_scale = 2.0
            options.accelerator_options = AcceleratorOptions(num_threads=4, device=AcceleratorDevice.CUDA)
            converter = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)})
            _database_call("update_job_progress", job_id, "ocr", 32)
            result = converter.convert(conversion_source)
            _database_call("update_job_progress", job_id, "tables_formulas", 58)

            version = int(context["version_number"])
            storage_base = f"{context['owner_id']}/documents/{context['document_ref']}/versions/v{version:04d}"
            asset_dir = temp / "assets"
            asset_dir.mkdir()
            manifest, assets = normalize_document(
                result.document,
                source_type=context["source_type"],
                source_filename=context["filename"],
                asset_dir=asset_dir,
                storage_base=storage_base,
                upload_asset=_storage_upload,
            )
            _database_call("update_job_progress", job_id, "assets", 76)
            manifest_path = temp / "manifest.json"
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
            manifest_storage_path = f"{storage_base}/manifest.json"
            _storage_upload(manifest_path, manifest_storage_path, "application/json")
            _database_call("update_job_progress", job_id, "assembling", 88)

            page_count = int(manifest["metadata"].get("pageCount") or 1)
            if page_count > 100:
                raise ValueError("Document exceeds the 100-page prototype limit")
            quality = {"semantic_blocks": len(manifest["sections"]), "preserved_figures": len(assets), "fallbacks": 0}
            _database_call("update_job_progress", job_id, "quality_check", 96)
            version_id = _database_call(
                "complete_job",
                job_id,
                manifest_storage_path,
                "docling-2.67.0",
                page_count,
                len(manifest["sections"]),
                json.dumps(quality),
            )

            if assets:
                import psycopg
                with psycopg.connect(os.environ["SUPABASE_DB_URL"], autocommit=True) as connection:
                    with connection.cursor() as cursor:
                        cursor.executemany(
                            """insert into public.document_assets
                            (version_id, owner_id, kind, sequence_number, storage_path, page_number, media_type, alt_text)
                            values (%s, %s::uuid, %s, %s, %s, %s, 'image/webp', %s)""",
                            [(version_id, context["owner_id"], asset.kind, asset.sequence_number, asset.storage_path, asset.page_number, asset.alt_text) for asset in assets],
                        )
    except Exception as error:
        safe_message = str(error).replace(os.environ.get("SUPABASE_SECRET_KEY", ""), "[redacted]")[:500]
        try:
            _database_call("fail_job", job_id, type(error).__name__[:80], safe_message)
        finally:
            raise


@app.function(image=image, secrets=[worker_secret], timeout=30, max_containers=1)
@modal.fastapi_endpoint(method="POST", requires_proxy_auth=True, docs=False)
async def dispatch(request: Request):
    body = await request.body()
    timestamp = request.headers.get("x-rpaper-timestamp", "")
    signature = request.headers.get("x-rpaper-signature", "")
    try:
        sent_at = int(timestamp)
    except ValueError:
        return {"accepted": False, "error": "invalid timestamp"}
    if abs(int(time.time()) - sent_at) > 300:
        return {"accepted": False, "error": "expired request"}
    expected = hmac.new(
        os.environ["WORKER_CALLBACK_SECRET"].encode(),
        timestamp.encode() + b"." + body,
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected, signature):
        return {"accepted": False, "error": "invalid signature"}
    payload = json.loads(body)
    document_id = int(payload["documentId"])
    job_id = int(payload["jobId"])
    call = process_document.spawn(document_id, job_id)
    return {"accepted": True, "workerCallId": call.object_id}
