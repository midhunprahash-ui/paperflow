"""Download the CPU parser's model artifacts when building the worker image."""
from pathlib import Path
from docling.utils.model_downloader import download_models

download_models(
    output_dir=Path("/opt/docling-models"),
    with_code_formula=False,
    with_picture_classifier=False,
    rapidocr_models=["onnxruntime:en"],
)
