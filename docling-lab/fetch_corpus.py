"""Download public research PDFs; keep source URLs/checksums beside local inputs."""
import hashlib
import argparse
import json
from pathlib import Path
import shutil
import urllib.request

ROOT = Path(__file__).resolve().parent

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--include-additional',action='store_true',help='Also fetch the two later structure-regression papers')
    args=parser.parse_args()
    target = ROOT / "inputs"
    target.mkdir(exist_ok=True)
    inventory = []
    cases=json.loads((ROOT / "corpus.json").read_text())
    if args.include_additional:
        cases+=json.loads((ROOT/'heldout-corpus.json').read_text())
    for case in cases:
        path = target / (case["id"] + ".pdf")
        if not path.exists():
            if "local_path" in case:
                shutil.copyfile(case["local_path"], path)
            else:
                request = urllib.request.Request(case["url"], headers={"User-Agent": "Rpaper-Docling-Evaluation/1.0"})
                with urllib.request.urlopen(request, timeout=120) as response:
                    data = response.read()
                if not data.startswith(b"%PDF-"):
                    raise ValueError(f"Not a PDF: {case['url']}")
                path.write_bytes(data)
        data = path.read_bytes()
        if case.get('sha256') and hashlib.sha256(data).hexdigest()!=case['sha256']:
            raise ValueError(f"Source changed for {case['id']}; retain the annotated PDF version before rerunning its tests")
        inventory.append({**case, "file": path.name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)})
        print(f"{case['id']}: {len(data):,} bytes", flush=True)
    (target / "sources.json").write_text(json.dumps(inventory, indent=2) + "\n")

if __name__ == "__main__":
    main()
