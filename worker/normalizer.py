from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
from typing import Any, Callable


@dataclass
class Asset:
    kind: str
    sequence_number: int
    path: Path
    storage_path: str
    page_number: int | None
    alt_text: str | None


def _label(item: Any) -> str:
    value = getattr(item, "label", "")
    return str(getattr(value, "value", value)).lower()


def _provenance(item: Any) -> tuple[int | None, list[float] | None]:
    provenance = getattr(item, "prov", None) or []
    if not provenance:
        return None, None
    first = provenance[0]
    page = getattr(first, "page_no", None)
    bbox = getattr(first, "bbox", None)
    if bbox is None:
        return page, None
    values = [getattr(bbox, name, None) for name in ("l", "t", "r", "b")]
    return page, values if all(value is not None for value in values) else None


def _heading_level(item: Any, text: str, iteration_level: int) -> int:
    numbered = re.match(r"^(\d+(?:\.\d+)*)(?:[.)])?\s+", text)
    if numbered:
        return min(4, len(numbered.group(1).split(".")))
    item_level = getattr(item, "level", None)
    raw_level = item_level if item_level is not None else iteration_level
    return max(1, min(4, int(raw_level or 1)))


def normalize_document(
    document: Any,
    *,
    source_type: str,
    source_filename: str,
    asset_dir: Path,
    storage_base: str,
    upload_asset: Callable[[Path, str, str], None],
) -> tuple[dict[str, Any], list[Asset]]:
    sections: list[dict[str, Any]] = []
    references: list[str] = []
    assets: list[Asset] = []
    title = Path(source_filename).stem
    authors: list[str] = []
    abstract: str | None = None
    figure_number = 0
    order = 0

    for item, iteration_level in document.iterate_items():
        label = _label(item)
        text = str(getattr(item, "text", "") or "").strip()
        page, bounds = _provenance(item)
        node_id = f"node-{order + 1:05d}"
        base: dict[str, Any] = {"id": node_id, "order": order + 1}
        if page is not None:
            base["page"] = page
        if bounds is not None:
            base["bounds"] = bounds

        if label == "title" and text:
            title = text
            continue
        if label in {"page_header", "page_footer"}:
            continue
        if label in {"section_header", "heading"} and text:
            order += 1
            level = _heading_level(item, text, iteration_level)
            sections.append(base | {"type": "heading", "level": level, "text": text})
            continue
        if label in {"formula", "equation"} and text:
            order += 1
            sections.append(base | {"type": "formula", "latex": text})
            continue
        if label == "table":
            try:
                frame = item.export_to_dataframe(doc=document)
                headers = [str(column) for column in frame.columns]
                rows = [[str(value) for value in row] for row in frame.fillna("").values.tolist()]
                if headers or rows:
                    order += 1
                    sections.append(base | {"type": "table", "headers": headers, "rows": rows})
                    continue
            except Exception:
                pass
        if label in {"picture", "figure"}:
            try:
                image = item.get_image(document)
            except Exception:
                image = None
            if image is not None:
                figure_number += 1
                local_path = asset_dir / f"fig-{figure_number:04d}.webp"
                image.save(local_path, "WEBP", quality=92, method=6)
                storage_path = f"{storage_base}/figures/{local_path.name}"
                upload_asset(local_path, storage_path, "image/webp")
                caption = text or f"Figure {figure_number}"
                assets.append(Asset("figure", figure_number, local_path, storage_path, page, caption))
                order += 1
                sections.append(base | {"type": "figure", "assetUrl": storage_path, "alt": caption, "caption": text or None})
                continue
        if label in {"list_item", "list"} and text:
            order += 1
            sections.append(base | {"type": "list", "ordered": False, "items": [text]})
            continue
        if label in {"code", "code_block"} and text:
            order += 1
            sections.append(base | {"type": "code", "code": text})
            continue
        if label in {"reference", "bibliography"} and text:
            references.append(text)
            continue
        if label == "abstract" and text:
            abstract = text
            continue
        if text:
            order += 1
            sections.append(base | {"type": "paragraph", "text": text})

    page_count = len(getattr(document, "pages", {}) or {}) or None
    metadata: dict[str, Any] = {"title": title, "authors": authors}
    if abstract:
        metadata["abstract"] = abstract
    if page_count:
        metadata["pageCount"] = page_count
    manifest = {
        "schemaVersion": 1,
        "metadata": metadata,
        "sections": sections,
        "references": references,
        "source": {"type": source_type, "filename": source_filename},
    }
    return manifest, assets
