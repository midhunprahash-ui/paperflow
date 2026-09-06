from __future__ import annotations

import argparse
import json
import re
import unicodedata
from pathlib import Path
from typing import Any


def normalized(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).lower()
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def flatten(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        return "\n".join(flatten(item) for item in value.values())
    if isinstance(value, list):
        return "\n".join(flatten(item) for item in value)
    return str(value) if value is not None else ""


def fraction(items: list[str], text: str) -> float:
    haystack = normalized(text)
    return sum(normalized(item) in haystack for item in items) / max(1, len(items))


def ordered_fraction(items: list[str], text: str) -> float:
    haystack = normalized(text)
    positions = [haystack.find(normalized(item)) for item in items]
    present = sum(position >= 0 for position in positions) / max(1, len(items))
    found = [position for position in positions if position >= 0]
    order = 1.0 if len(found) < 2 else sum(a < b for a, b in zip(found, found[1:])) / (len(found) - 1)
    return 0.6 * present + 0.4 * order


def score(name: str, payload: dict[str, Any], truth: dict[str, Any]) -> dict[str, Any]:
    text = payload.get("markdown") or flatten(payload)
    weights = truth["weights"]
    metadata = 0.6 * fraction([truth["title"]], text) + 0.4 * fraction(truth["authors"], text)
    headings = fraction(truth["sections"], text)
    equations = fraction(truth["equation_anchors"], text)
    table = 0.35 * fraction([truth["table"]["label"]], text) + 0.65 * fraction(truth["table"]["headers"], text)
    figure_mentions = len(re.findall(r"\bfig(?:ure)?\.?\s*[1-4]\b", text, flags=re.IGNORECASE))
    figures = min(1.0, max(figure_mentions, int(payload.get("image_count") or 0)) / truth["figures"])
    reference_numbers = {
        int(item)
        for item in re.findall(r"(?:^|\n)\s*(?:[-*]\s*)?\[?(\d{1,2})\]?[.)]?\s+", text)
        if 1 <= int(item) <= truth["references"]
    }
    references = 0.65 * min(1.0, len(reference_numbers) / truth["references"]) + 0.35 * fraction(truth["reference_anchors"], text)
    components = {
        "reading_order": ordered_fraction(truth["reading_order"], text),
        "metadata": metadata,
        "headings": headings,
        "equations": equations,
        "table": table,
        "figures": figures,
        "references": references,
    }
    points = {key: round(value * weights[key], 2) for key, value in components.items()}
    return {
        "parser": name,
        "score": round(sum(points.values()), 2),
        "points": points,
        "elapsed_seconds": payload.get("elapsed_seconds"),
        "notes": "Automatic regression score; page-by-page human review is required.",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ground-truth", required=True, type=Path)
    parser.add_argument("--input", action="append", required=True, help="NAME=JSON_PATH")
    parser.add_argument("--output", required=True, type=Path)
    arguments = parser.parse_args()
    truth = json.loads(arguments.ground_truth.read_text(encoding="utf-8"))
    results = []
    for item in arguments.input:
        name, path = item.split("=", 1)
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        results.append(score(name, payload, truth))
    results.sort(key=lambda result: result["score"], reverse=True)
    report = {"fixture": truth["document"], "results": results}
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
