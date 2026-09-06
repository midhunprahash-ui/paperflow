"""Local-only PDF -> Docling JSON, Markdown, images, and review evidence.

No app, database, API key, hosted inference, or rewriting LLM is used.
Model weights are downloaded by Docling on first use.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import importlib.metadata
import json
import logging
import os
from pathlib import Path
import resource
import time

MAX_PAGES = 16

def inspect_pdf(path: Path) -> dict:
    import pymupdf
    try:
        pdf = pymupdf.open(path)
    except (pymupdf.FileDataError, pymupdf.EmptyFileError) as error:
        raise ValueError('Invalid or empty PDF') from error
    with pdf:
        if not pdf.is_pdf:
            raise ValueError('Input must be a PDF document')
        if pdf.needs_pass:
            raise ValueError("Encrypted PDF: provide an unlocked copy")
        if not 1 <= len(pdf) <= MAX_PAGES:
            raise ValueError(f"PDF has {len(pdf)} pages; supported range is 1-{MAX_PAGES}")
        if not any(p.get_text().strip() or p.get_images() or p.get_drawings() for p in pdf):
            raise ValueError('PDF contains no visible content')
        return {"pages": len(pdf), "text_chars_by_page": [len(p.get_text()) for p in pdf],
                "bookmarks": pdf.get_toc(), "page_rotations":[p.rotation for p in pdf],
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def conversion_issues(status, document, expected_pages):
    from docling.datamodel.base_models import ConversionStatus
    issues=[]
    if status != ConversionStatus.SUCCESS:
        issues.append('conversion_status_not_success')
    if set(document.pages) != set(range(1,expected_pages+1)):
        issues.append('converted_page_inventory_mismatch')
    if not any(True for _ in document.iterate_items()):
        issues.append('conversion_has_no_content_blocks')
    return issues


def normalize_page_rotation(source: Path, out: Path, rotations):
    """Canonical coordinates for /Rotate PDFs; the uploaded file stays intact.

    This handles PDF rotation metadata, not skew or sideways pixels in a scan.
    The rotation list remains in run.json for source-coordinate mapping.
    """
    if not any(rotations):
        return source
    import pymupdf
    destination=out/'source-normalized.pdf'
    if destination.exists():
        raise ValueError('Normalized source already exists; use a new output directory')
    with pymupdf.open(source) as pdf:
        for page in pdf:page.set_rotation(0)
        pdf.save(destination,deflate=True)
    return destination

def build_converter(formulas: bool, device: str, threads: int, force_ocr: bool, ocr_line_rotation: bool = False):
    # ONNX Runtime 1.29's macOS telemetry uploader crashed at interpreter exit
    # in both scanned-JMLR runs. Disable it before runtime initialization.
    os.environ["ORT_DISABLE_TELEMETRY"] = "1"
    import onnxruntime
    onnxruntime.disable_telemetry_events()
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import (
        PdfPipelineOptions, TableFormerMode, RapidOcrOptions, AcceleratorOptions,
    )
    from docling.document_converter import DocumentConverter, PdfFormatOption

    options = PdfPipelineOptions()
    options.accelerator_options = AcceleratorOptions(device=device, num_threads=threads)
    options.do_ocr = True
    options.ocr_options = RapidOcrOptions(backend="onnxruntime", lang=["en"], force_full_page_ocr=force_ocr,
                                        use_cls=ocr_line_rotation)
    options.do_table_structure = True
    options.table_structure_options.mode = TableFormerMode.ACCURATE
    options.do_formula_enrichment = formulas
    if formulas:
        from docling.datamodel.vlm_engine_options import TransformersVlmEngineOptions
        options.code_formula_options.engine_options = TransformersVlmEngineOptions(
            device=device, torch_dtype="float32", load_in_8bit=False, use_kv_cache=True,
        )
    options.generate_page_images = True
    options.generate_picture_images = True
    options.images_scale = 2.0
    options.generate_parsed_pages = True
    # Fail visibly rather than silently run a version that flattens all headings.
    from docling.datamodel.pipeline_options import HeadingHierarchyOptions
    options.heading_hierarchy_options = HeadingHierarchyOptions(enabled=True)
    for field in ("ocr_batch_size", "layout_batch_size", "table_batch_size"):
        if hasattr(options, field):
            setattr(options, field, 1)
    converter = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)})
    if formulas:
        converter.initialize_pipeline(InputFormat.PDF)
        for pipeline in converter.initialized_pipelines.values():
            for stage in pipeline.enrichment_pipe:
                if type(stage).__name__ == "CodeFormulaVlmModel":
                    stage.elements_batch_size = 1
                    # Transformers 4.57 inherits use_cache=False from this model's
                    # top-level config even when the engine's GenerationConfig
                    # requests True. Set the model default explicitly as well.
                    model = stage.engine.vlm_model
                    model.config.use_cache = True
                    model.generation_config.use_cache = True
    return converter

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--formulas", action="store_true", help="Run local formula recognition (slower, more memory)")
    parser.add_argument("--device", choices=["cpu", "mps"], default="cpu")
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--force-ocr", action="store_true")
    parser.add_argument("--ocr-line-rotation", action="store_true", help="Experimental per-line 180-degree classifier; can invert upright scientific text")
    args = parser.parse_args()
    if args.threads<1:
        parser.error('--threads must be positive')
    os.environ.setdefault("OMP_NUM_THREADS", str(args.threads))
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    start = time.monotonic()
    source = args.pdf.resolve(strict=True)
    info = inspect_pdf(source)
    out = args.output.resolve()
    if (out / "raw.json").exists():
        parser.error("Output already contains a run; use a new output directory to preserve comparison evidence")
    out.mkdir(parents=True, exist_ok=True)
    uploaded_source=source
    source=normalize_page_rotation(source,out,info['page_rotations'])
    (out / "run.json").write_text(json.dumps({"state":"running", "input":str(source), **info}, indent=2))
    print(f"Parsing {source.name}: {info['pages']} pages; device={args.device}, formulas={args.formulas}", flush=True)
    converter = build_converter(args.formulas, args.device, args.threads, args.force_ocr, args.ocr_line_rotation)
    print("Converter configured; starting layout/OCR/table inference", flush=True)
    result = converter.convert(source, raises_on_error=True)
    doc = result.document
    issues = conversion_issues(result.status,doc,info['pages'])
    from docling_core.types.doc import ImageRefMode
    doc.save_as_json(out / "raw.json", image_mode=ImageRefMode.REFERENCED)
    doc.save_as_markdown(out / "baseline.md", image_mode=ImageRefMode.REFERENCED)
    cells=[]
    for page in result.pages:
        for cell in page.cells:
            if cell.from_ocr:
                bbox=cell.rect.to_bounding_box().to_top_left_origin(page.size.height)
                cells.append({'page':page.page_no,'text':cell.text,'confidence':cell.confidence,
                              'bbox':[bbox.l,bbox.t,bbox.r,bbox.b]})
    (out/'ocr-lines.json').write_text(json.dumps(cells,indent=2,ensure_ascii=False))
    blocks = []
    for item, depth in doc.iterate_items():
        blocks.append({"id":item.self_ref, "label":item.label.value,
                       "text":getattr(item,"text",None), "level":getattr(item,"level",None),
                       "depth":depth, "provenance":[p.model_dump(mode="json") for p in item.prov]})
    (out / "blocks.json").write_text(json.dumps(blocks, indent=2, ensure_ascii=False))
    elapsed = time.monotonic() - start
    report = {"state":"failed" if issues else "converted", "input":str(source), **info,
              "uploaded_input":str(uploaded_source),
              "parsed_input_sha256":hashlib.sha256(source.read_bytes()).hexdigest(),
              "conversion_issues":issues,
              "docling":importlib.metadata.version("docling"),
              "docling_core":importlib.metadata.version("docling-core"),
              "device":args.device, "threads":args.threads, "formulas":args.formulas,
              "ocr_line_rotation":args.ocr_line_rotation,
              "onnx_telemetry_disabled":True,
              "seconds":round(elapsed,2),
              "peak_rss_bytes":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * (1 if os.sys.platform == "darwin" else 1024),
              "status":str(result.status), "counts":dict(Counter(b["label"] for b in blocks)),
              "output_pages":sorted(doc.pages),
              "pages_with_blocks":sorted({p["page_no"] for b in blocks for p in b["provenance"]}),
              "errors":[str(e) for e in result.errors],
              "note":"Conversion success is not fidelity approval. Inspect review.html and quality.json."}
    (out / "run.json").write_text(json.dumps(report, indent=2, ensure_ascii=False))
    from review import prepare_review
    prepare_review(source, out)
    print(json.dumps(report, indent=2), flush=True)
    if issues:
        raise SystemExit(1)

if __name__ == "__main__":
    main()
