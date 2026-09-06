from __future__ import annotations

import json
import tempfile
import time
from pathlib import Path

import modal


app = modal.App("rpaper-marker-benchmark")
model_cache = modal.Volume.from_name("rpaper-marker-models", create_if_missing=True)
cache_path = "/root/.cache/datalab/models"

image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install("git", "libgl1", "libglib2.0-0")
    .env({"TORCH_DEVICE": "cuda"})
    # Marker 2 requires a separately hosted Surya vLLM/llama.cpp service.
    # 1.10.2 is the newest single-container release suitable for this benchmark.
    .pip_install("marker-pdf[full]==1.10.2")
)


@app.function(
    image=image,
    gpu="T4",
    memory=16384,
    timeout=1200,
    volumes={cache_path: model_cache},
)
def parse(pdf_bytes: bytes) -> str:
    from marker.config.parser import ConfigParser
    from marker.converters.pdf import PdfConverter
    from marker.models import create_model_dict
    from marker.output import text_from_rendered

    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="rpaper-marker-") as directory:
        source = Path(directory) / "source.pdf"
        source.write_bytes(pdf_bytes)
        config_parser = ConfigParser(
            {
                "filepath": str(source),
                "output_format": "markdown",
                "force_ocr": False,
                "paginate_output": True,
                "use_llm": False,
            }
        )
        models = create_model_dict()
        model_cache.commit()
        converter = PdfConverter(
            config=config_parser.generate_config_dict(),
            artifact_dict=models,
            processor_list=config_parser.get_processors(),
            renderer=config_parser.get_renderer(),
        )
        rendered = converter(str(source))
        markdown, _, images = text_from_rendered(rendered)
        result = {
            "parser": "marker-pdf",
            "version": "1.10.2",
            "mode": "single-container-no-llm",
            "elapsed_seconds": round(time.monotonic() - started, 3),
            "image_count": len(images),
            "metadata": rendered.metadata,
            "markdown": markdown,
        }
        return json.dumps(result, ensure_ascii=False, default=str)


@app.local_entrypoint()
def main(input_pdf: str, output_file: str) -> None:
    source = Path(input_pdf).expanduser().resolve()
    destination = Path(output_file).expanduser().resolve()
    if not source.is_file() or source.suffix.lower() != ".pdf":
        raise ValueError(f"Not a PDF file: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(parse.remote(source.read_bytes()), encoding="utf-8")
    print(f"Marker result saved to {destination}")
