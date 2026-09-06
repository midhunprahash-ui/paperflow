from __future__ import annotations

import json
import subprocess
import tempfile
import time
from pathlib import Path

import modal


app = modal.App("rpaper-grobid-benchmark")

image = modal.Image.from_registry(
    "grobid/grobid:0.9.1-crf",
    add_python="3.11",
).pip_install("requests==2.32.5")


@app.function(image=image, cpu=4, memory=6144, timeout=900)
def parse(pdf_bytes: bytes) -> str:
    import requests

    started = time.monotonic()
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
                    response = requests.get("http://127.0.0.1:8070/api/health", timeout=3)
                    if response.ok:
                        break
                except requests.RequestException:
                    pass
                time.sleep(2)
            else:
                raise RuntimeError(f"GROBID did not become healthy: {log.read_text(errors='replace')[-3000:]}")

            with source.open("rb") as file_handle:
                response = requests.post(
                    "http://127.0.0.1:8070/api/processFulltextDocument",
                    files={"input": ("source.pdf", file_handle, "application/pdf")},
                    data={"includeRawCitations": "1", "includeRawAffiliations": "1"},
                    timeout=600,
                )
            response.raise_for_status()
            return json.dumps(
                {
                    "parser": "grobid",
                    "version": "0.9.1-crf",
                    "mode": "fulltext-with-raw-citations",
                    "elapsed_seconds": round(time.monotonic() - started, 3),
                    "tei": response.text,
                },
                ensure_ascii=False,
            )
        finally:
            service.terminate()
            try:
                service.wait(timeout=10)
            except subprocess.TimeoutExpired:
                service.kill()


@app.local_entrypoint()
def main(input_pdf: str, output_file: str) -> None:
    source = Path(input_pdf).expanduser().resolve()
    destination = Path(output_file).expanduser().resolve()
    if not source.is_file() or source.suffix.lower() != ".pdf":
        raise ValueError(f"Not a PDF file: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(parse.remote(source.read_bytes()), encoding="utf-8")
    print(f"GROBID result saved to {destination}")
