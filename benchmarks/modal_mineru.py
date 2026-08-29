from __future__ import annotations

import json
import subprocess
import tempfile
import time
from pathlib import Path

import modal


app = modal.App("rpaper-mineru-benchmark")
model_cache = modal.Volume.from_name("rpaper-mineru-models", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "libgl1", "libglib2.0-0", "poppler-utils")
    .env(
        {
            "HF_HOME": "/models/huggingface",
            "MINERU_MODEL_SOURCE": "huggingface",
            "MINERU_TASK_RESULT_TIMEOUT_SECONDS": "1200",
        }
    )
    .uv_pip_install("mineru[all]==3.4.0")
)


@app.function(
    image=image,
    # MinerU 3.4's vLLM engine failed to initialize on the older T4 runtime.
    gpu="L4",
    memory=32768,
    timeout=1800,
    volumes={"/models": model_cache},
)
def parse(pdf_bytes: bytes) -> str:
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="rpaper-mineru-") as directory:
        root = Path(directory)
        source = root / "source.pdf"
        output = root / "output"
        source.write_bytes(pdf_bytes)
        completed = subprocess.run(
            [
                "mineru",
                "-p",
                str(source),
                "-o",
                str(output),
                "-b",
                "hybrid-engine",
                "--effort",
                "high",
                "-m",
                "auto",
                "-f",
                "true",
                "-t",
                "true",
                "--image-analysis",
                "true",
            ],
            capture_output=True,
            text=True,
            timeout=1500,
            check=False,
        )
        # Preserve downloaded weights even when backend initialization fails,
        # so a compatible-GPU retry does not pay the cold-download cost again.
        model_cache.commit()
        if completed.returncode != 0:
            raise RuntimeError(completed.stderr[-4000:] or completed.stdout[-4000:])
        markdown_files = sorted(output.rglob("*.md"), key=lambda path: path.stat().st_size, reverse=True)
        if not markdown_files:
            raise RuntimeError("MinerU completed without producing Markdown")
        content = markdown_files[0].read_text(encoding="utf-8")
        image_count = sum(1 for path in output.rglob("*") if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"})
        return json.dumps(
            {
                "parser": "mineru",
                "version": "3.4.0",
                "mode": "hybrid-engine-high",
                "elapsed_seconds": round(time.monotonic() - started, 3),
                "image_count": image_count,
                "markdown": content,
            },
            ensure_ascii=False,
        )


@app.local_entrypoint()
def main(input_pdf: str, output_file: str) -> None:
    source = Path(input_pdf).expanduser().resolve()
    destination = Path(output_file).expanduser().resolve()
    if not source.is_file() or source.suffix.lower() != ".pdf":
        raise ValueError(f"Not a PDF file: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(parse.remote(source.read_bytes()), encoding="utf-8")
    print(f"MinerU result saved to {destination}")
