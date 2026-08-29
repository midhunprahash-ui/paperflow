from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.parse import quote

import modal
from fastapi import Request


APP_NAME = "rpaper-parser"
BUCKET = "research-documents"

controller_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("clamav", "libreoffice", "poppler-utils")
    .uv_pip_install("fastapi==0.123.10", "psycopg[binary]==3.3.2", "requests==2.32.5")
    .add_local_python_source("normalizer")
)

mineru_models = modal.Volume.from_name("rpaper-mineru-models", create_if_missing=True)
mineru_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "libgl1", "libglib2.0-0", "poppler-utils")
    .env(
        {
            "HF_HOME": "/models/huggingface",
            "MINERU_MODEL_SOURCE": "huggingface",
            "MINERU_TASK_RESULT_TIMEOUT_SECONDS": "1200",
        }
    )
    .uv_pip_install("mineru[all]==3.4.0", "requests==2.32.5")
    .add_local_python_source("normalizer")
)

docling_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("poppler-utils", "tesseract-ocr")
    .uv_pip_install("docling==2.67.0", "pillow==11.3.0", "requests==2.32.5")
    .add_local_python_source("normalizer")
)

grobid_image = modal.Image.from_registry(
    "grobid/grobid:0.9.1-crf",
    add_python="3.11",
).pip_install("requests==2.32.5")

app = modal.App(APP_NAME)
worker_secret = modal.Secret.from_name(
    "rpaper-worker-secrets",
    required_keys=["SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_DB_URL", "WORKER_CALLBACK_SECRET"],
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
                       d.source_path, d.source_checksum, coalesce(max(v.version_number), 0) + 1
                from public.documents d
                join public.processing_jobs j on j.document_id = d.id and j.id = %s
                left join public.document_versions v on v.document_id = d.id
                where d.id = %s and d.deleted_at is null
                group by d.owner_id, d.document_ref, d.source_filename, d.source_type,
                         d.source_path, d.source_checksum
                """,
                (job_id, document_id),
            )
            row = cursor.fetchone()
            if not row:
                raise ValueError("Document job does not exist")
            keys = ("owner_id", "document_ref", "filename", "source_type", "source_path", "checksum", "version_number")
            return dict(zip(keys, row))


def _inspect_pdf(pdf_path: Path) -> dict:
    info = subprocess.run(["pdfinfo", str(pdf_path)], capture_output=True, text=True, timeout=30, check=True).stdout
    page_match = re.search(r"^Pages:\s+(\d+)", info, re.MULTILINE)
    page_count = int(page_match.group(1)) if page_match else 0
    text = subprocess.run(
        ["pdftotext", "-layout", str(pdf_path), "-"],
        capture_output=True,
        text=True,
        timeout=90,
        check=True,
    ).stdout
    page_text = text.split("\f")
    populated_pages = [page for page in page_text[:page_count] if len(page.strip()) >= 80]
    scan_ratio = 1 - (len(populated_pages) / max(page_count, 1))
    return {
        "page_count": page_count,
        "born_digital": scan_ratio < 0.5,
        "scan_ratio": round(scan_ratio, 3),
        "embedded_text_characters": len(text.strip()),
        "math_marker_count": len(re.findall(r"(?:=|≤|≥|∑|∫|√|\b(?:sin|cos|log)\s*\()", text)),
        "table_marker_count": len(re.findall(r"\b(?:table|accuracy|precision|recall|f1[- ]?score)\b", text, re.IGNORECASE)),
        "routing_basis": "page traits, never publisher template",
    }


def _asset_payload(assets) -> list[dict]:
    return [
        {
            "kind": asset.kind,
            "sequence_number": asset.sequence_number,
            "storage_path": asset.storage_path,
            "page_number": asset.page_number,
            "bounds": asset.bounds,
            "media_type": asset.media_type,
            "alt_text": asset.alt_text,
        }
        for asset in assets
    ]


@app.function(
    image=mineru_image,
    gpu="L4",
    memory=32768,
    secrets=[worker_secret],
    max_containers=1,
    min_containers=0,
    timeout=1800,
    volumes={"/models": mineru_models},
)
def parse_with_mineru(pdf_bytes: bytes, context: dict, storage_base: str) -> dict:
    from normalizer import normalize_mineru_content

    with tempfile.TemporaryDirectory(prefix="rpaper-mineru-") as directory:
        root = Path(directory)
        source = root / "source.pdf"
        output = root / "output"
        assets_dir = root / "assets"
        assets_dir.mkdir()
        source.write_bytes(pdf_bytes)
        completed = subprocess.run(
            [
                "mineru", "-p", str(source), "-o", str(output),
                "-b", "hybrid-engine", "--effort", "high", "-m", "auto",
                "-f", "true", "-t", "true", "--image-analysis", "false",
            ],
            capture_output=True,
            text=True,
            timeout=1500,
            check=False,
        )
        mineru_models.commit()
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr[-4000:] or completed.stdout[-4000:])
        candidates = [path for path in output.rglob("*_content_list.json") if not path.name.endswith("_content_list_v2.json")]
        if not candidates:
            raise RuntimeError("MinerU completed without a content list")
        content_path = max(candidates, key=lambda path: path.stat().st_size)
        content = json.loads(content_path.read_text(encoding="utf-8"))
        if not isinstance(content, list):
            raise RuntimeError("MinerU content list has an unexpected shape")
        manifest, assets = normalize_mineru_content(
            content,
            source_type=context["source_type"],
            source_filename=context["filename"],
            output_root=content_path.parent,
            asset_dir=assets_dir,
            storage_base=storage_base,
            upload_asset=_storage_upload,
        )
        return {"manifest": manifest, "assets": _asset_payload(assets), "parser": "mineru-3.4.0-hybrid-high"}


@app.function(
    image=docling_image,
    gpu="T4",
    secrets=[worker_secret],
    max_containers=1,
    min_containers=0,
    timeout=1200,
)
def parse_with_docling(pdf_bytes: bytes, context: dict, storage_base: str) -> dict:
    from docling.datamodel.accelerator_options import AcceleratorDevice, AcceleratorOptions
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions, TableFormerMode
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from normalizer import normalize_document

    with tempfile.TemporaryDirectory(prefix="rpaper-docling-") as directory:
        root = Path(directory)
        source = root / "source.pdf"
        assets_dir = root / "assets"
        assets_dir.mkdir()
        source.write_bytes(pdf_bytes)
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
        result = converter.convert(source)
        manifest, assets = normalize_document(
            result.document,
            source_type=context["source_type"],
            source_filename=context["filename"],
            asset_dir=assets_dir,
            storage_base=storage_base,
            upload_asset=_storage_upload,
        )
        return {"manifest": manifest, "assets": _asset_payload(assets), "parser": "docling-2.67.0-fallback"}


@app.function(image=grobid_image, cpu=4, memory=6144, timeout=900, max_containers=1)
def parse_with_grobid(pdf_bytes: bytes) -> str:
    import requests

    with tempfile.TemporaryDirectory(prefix="rpaper-grobid-") as directory:
        root = Path(directory)
        source = root / "source.pdf"
        log = root / "grobid.log"
        source.write_bytes(pdf_bytes)
        with log.open("wb") as stream:
            service = subprocess.Popen(
                ["./grobid-service/bin/grobid-service"],
                cwd="/opt/grobid",
                stdout=stream,
                stderr=subprocess.STDOUT,
            )
        try:
            deadline = time.monotonic() + 180
            while time.monotonic() < deadline:
                try:
                    if requests.get("http://127.0.0.1:8070/api/health", timeout=3).ok:
                        break
                except requests.RequestException:
                    pass
                time.sleep(2)
            else:
                raise RuntimeError(f"GROBID did not become healthy: {log.read_text(errors='replace')[-3000:]}")
            with source.open("rb") as handle:
                response = requests.post(
                    "http://127.0.0.1:8070/api/processFulltextDocument",
                    files={"input": ("source.pdf", handle, "application/pdf")},
                    data={"includeRawCitations": "1", "includeRawAffiliations": "1"},
                    timeout=600,
                )
            response.raise_for_status()
            return response.text
        finally:
            service.terminate()
            try:
                service.wait(timeout=10)
            except subprocess.TimeoutExpired:
                service.kill()


@app.function(
    image=controller_image,
    secrets=[worker_secret],
    max_containers=1,
    min_containers=0,
    timeout=2400,
)
def process_document(document_id: int, job_id: int) -> None:
    from normalizer import Asset, extract_grobid_metadata, merge_grobid_metadata, validate_manifest

    call_id = modal.current_function_call_id()
    started = False
    try:
        context = _job_context(job_id, document_id)
        _database_call("mark_job_started", job_id, call_id)
        started = True
        with tempfile.TemporaryDirectory(prefix="rpaper-control-") as directory:
            root = Path(directory)
            source = root / f"source.{context['source_type']}"
            source.write_bytes(_storage_download(context["source_path"]))
            scan = subprocess.run(["clamscan", "--no-summary", str(source)], capture_output=True, text=True, timeout=120)
            if scan.returncode == 1:
                raise ValueError("The uploaded document did not pass malware scanning")
            _database_call("update_job_progress", job_id, "layout", 18)

            pdf_path = source
            if context["source_type"] == "docx":
                subprocess.run(
                    ["libreoffice", "--headless", "--convert-to", "pdf", "--outdir", str(root), str(source)],
                    capture_output=True,
                    timeout=180,
                    check=True,
                )
                pdf_path = root / "source.pdf"
                if not pdf_path.exists():
                    raise ValueError("DOCX conversion did not produce a PDF")

            traits = _inspect_pdf(pdf_path)
            if traits["page_count"] < 1 or traits["page_count"] > 100:
                raise ValueError("Document must contain between 1 and 100 pages")
            pdf_bytes = pdf_path.read_bytes()
            version = int(context["version_number"])
            storage_base = f"{context['owner_id']}/documents/{context['document_ref']}/versions/v{version:04d}"

            grobid_call = parse_with_grobid.spawn(pdf_bytes)
            _database_call("update_job_progress", job_id, "ocr", 32)
            fallback_reason: str | None = None
            try:
                parsed = parse_with_mineru.remote(pdf_bytes, context, storage_base)
            except Exception as mineru_error:
                fallback_reason = f"{type(mineru_error).__name__}: {str(mineru_error)[:180]}"
                parsed = parse_with_docling.remote(pdf_bytes, context, storage_base)
            _database_call("update_job_progress", job_id, "tables_formulas", 58)

            grobid_metadata = None
            try:
                grobid_metadata = extract_grobid_metadata(grobid_call.get(timeout=900))
            except Exception:
                grobid_metadata = None
            manifest = merge_grobid_metadata(parsed["manifest"], grobid_metadata)
            if context.get("checksum"):
                manifest["source"]["checksum"] = context["checksum"]
            assets = parsed["assets"]
            asset_views = [
                Asset(
                    item["kind"], item["sequence_number"], Path(item["storage_path"]), item["storage_path"],
                    item.get("page_number"), item.get("alt_text"), item.get("media_type", "image/webp"), item.get("bounds"),
                )
                for item in assets
            ]
            quality = validate_manifest(manifest, asset_views)
            quality.update(
                {
                    "parser": parsed["parser"],
                    "grobid_repair": bool(grobid_metadata),
                    "fallback_reason": fallback_reason,
                    "document_traits": traits,
                }
            )
            _database_call("update_job_progress", job_id, "assets", 76)
            manifest_path = root / "manifest.json"
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
            manifest_storage_path = f"{storage_base}/manifest.json"
            _storage_upload(manifest_path, manifest_storage_path, "application/json")
            _database_call("update_job_progress", job_id, "assembling", 88)
            _database_call("update_job_progress", job_id, "quality_check", 96)
            _database_call(
                "complete_job_v2",
                job_id,
                manifest_storage_path,
                parsed["parser"],
                int(manifest["metadata"].get("pageCount") or traits["page_count"]),
                len(manifest["sections"]),
                json.dumps(quality),
                manifest["metadata"]["title"],
                manifest["metadata"].get("authors", []),
                json.dumps(assets),
            )
    except Exception as error:
        secret = os.environ.get("SUPABASE_SECRET_KEY", "")
        safe_message = str(error).replace(secret, "[redacted]")[:500]
        if started:
            try:
                _database_call("fail_job", job_id, type(error).__name__[:80], safe_message)
            finally:
                raise
        raise


@app.function(image=controller_image, secrets=[worker_secret], timeout=30, max_containers=1)
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
