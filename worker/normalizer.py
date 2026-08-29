from __future__ import annotations

from dataclasses import dataclass
from difflib import SequenceMatcher
from html.parser import HTMLParser
from pathlib import Path
import re
from typing import Any, Callable
from xml.etree import ElementTree


@dataclass
class Asset:
    kind: str
    sequence_number: int
    path: Path
    storage_path: str
    page_number: int | None
    alt_text: str | None
    media_type: str = "image/webp"
    bounds: list[float] | None = None


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


class _TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.rows: list[list[tuple[str, bool]]] = []
        self._row: list[tuple[str, bool]] | None = None
        self._cell: list[str] | None = None
        self._header = False

    def handle_starttag(self, tag: str, _attrs: list[tuple[str, str | None]]) -> None:
        if tag == "tr":
            self._row = []
        elif tag in {"th", "td"} and self._row is not None:
            self._cell = []
            self._header = tag == "th"

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag in {"th", "td"} and self._row is not None and self._cell is not None:
            self._row.append((_clean_text("".join(self._cell)), self._header))
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if self._row:
                self.rows.append(self._row)
            self._row = None


def _clean_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _caption(item: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = item.get(key)
        if isinstance(value, list):
            text = _clean_text(" ".join(str(part) for part in value))
        else:
            text = _clean_text(value)
        if text:
            return text
    return None


def _table_rows(html: str) -> tuple[list[str], list[list[str]]]:
    parser = _TableParser()
    parser.feed(html or "")
    if not parser.rows:
        return [], []
    first = parser.rows[0]
    has_header = any(header for _text, header in first)
    headers = [text for text, _header in first] if has_header else []
    body = parser.rows[1:] if has_header else parser.rows
    return headers, [[text for text, _header in row] for row in body]


def _mineru_heading_level(text: str, mineru_level: Any = None) -> int:
    roman = re.match(r"^([IVXLCDM]+)\.\s+", text, re.IGNORECASE)
    letter = re.match(r"^[A-Z]\.\s+", text)
    numbered = re.match(r"^(\d+(?:\.\d+)*)(?:[.)])?\s+", text)
    if roman:
        return 1
    if letter:
        return 2
    if numbered:
        return min(4, len(numbered.group(1).split(".")))
    try:
        return max(1, min(4, int(mineru_level or 1)))
    except (TypeError, ValueError):
        return 1


def _formula(value: Any) -> tuple[str, str | None]:
    text = str(value or "").strip()
    text = re.sub(r"^\$\$|\$\$$", "", text).strip()
    text = re.sub(r"^\\\[|\\\]$", "", text).strip()
    tag = re.search(r"\\tag\{([^}]+)\}\s*$", text)
    if tag:
        return text[: tag.start()].strip(), tag.group(1).strip()
    label = re.search(r"\s+\((\d+[a-z]?)\)\s*$", text, re.IGNORECASE)
    if label:
        return text[: label.start()].strip(), label.group(1)
    return text, None


def _list_items(value: Any) -> list[str]:
    if not isinstance(value, list):
        return [_clean_text(value)] if _clean_text(value) else []
    items: list[str] = []
    for item in value:
        if isinstance(item, str):
            text = _clean_text(item)
        elif isinstance(item, dict):
            content = item.get("item_content", item.get("content", ""))
            if isinstance(content, list):
                text = _clean_text("".join(str(part.get("content", "")) if isinstance(part, dict) else str(part) for part in content))
            else:
                text = _clean_text(content)
        else:
            text = _clean_text(item)
        if text:
            items.append(text)
    return items


def _safe_output_image(output_root: Path, raw_path: Any) -> Path | None:
    relative = str(raw_path or "").strip().lstrip("/")
    if not relative:
        return None
    candidate = (output_root / relative).resolve()
    root = output_root.resolve()
    if candidate != root and root not in candidate.parents:
        return None
    return candidate if candidate.is_file() else None


def normalize_mineru_content(
    content: list[dict[str, Any]],
    *,
    source_type: str,
    source_filename: str,
    output_root: Path,
    asset_dir: Path,
    storage_base: str,
    upload_asset: Callable[[Path, str, str], None],
) -> tuple[dict[str, Any], list[Asset]]:
    """Convert MinerU's stable content-list format into Rpaper schema v1."""
    from PIL import Image

    sections: list[dict[str, Any]] = []
    references: list[str] = []
    assets: list[Asset] = []
    title = Path(source_filename).stem
    abstract: str | None = None
    in_references = False
    order = 0
    visual_number = 0
    max_page = 0

    def add(node: dict[str, Any], item: dict[str, Any]) -> None:
        nonlocal order, max_page
        order += 1
        page_index = item.get("page_idx")
        page = int(page_index) + 1 if isinstance(page_index, int) and page_index >= 0 else None
        if page:
            max_page = max(max_page, page)
        bounds = item.get("bbox")
        base: dict[str, Any] = {"id": f"node-{order:05d}", "order": order}
        if page:
            base["page"] = page
        if isinstance(bounds, list) and len(bounds) == 4 and all(isinstance(value, (int, float)) for value in bounds):
            base["bounds"] = bounds
        sections.append(base | node)

    for index, item in enumerate(content):
        if not isinstance(item, dict):
            continue
        kind = str(item.get("type", "")).lower()
        text = _clean_text(item.get("text"))
        level = item.get("text_level")

        if kind in {"header", "footer", "page_number", "aside_text"}:
            continue
        if kind == "text":
            if level and index < 12 and title == Path(source_filename).stem:
                title = text or title
                continue
            if re.match(r"^(references|bibliography)\s*$", text, re.IGNORECASE):
                in_references = True
                continue
            if in_references:
                if text:
                    references.append(re.sub(r"^\s*(?:\[\d+\]|\d+[.)])\s*", "", text))
                continue
            abstract_match = re.match(r"^abstract\s*[—–:-]\s*(.+)$", text, re.IGNORECASE)
            if abstract_match and abstract is None:
                abstract = abstract_match.group(1).strip()
                continue
            if level and text:
                add({"type": "heading", "level": _mineru_heading_level(text, level), "text": text}, item)
            elif text:
                add({"type": "paragraph", "text": text}, item)
            continue

        if kind == "equation":
            latex, label = _formula(item.get("text", item.get("math_content")))
            if latex:
                node: dict[str, Any] = {"type": "formula", "latex": latex}
                if label:
                    node["label"] = label
                add(node, item)
            continue

        if kind == "list":
            items = _list_items(item.get("list_items"))
            if item.get("sub_type") == "ref_text" or in_references:
                references.extend(re.sub(r"^\s*(?:\[\d+\]|\d+[.)])\s*", "", entry) for entry in items)
            elif items:
                add({"type": "list", "ordered": item.get("attribute") == "ordered", "items": items}, item)
            continue

        if kind == "code":
            code = _clean_text(item.get("code_body"))
            if code:
                add({"type": "code", "code": code}, item)
            continue

        if kind == "table":
            headers, rows = _table_rows(str(item.get("table_body", item.get("html", ""))))
            caption = _caption(item, "table_caption")
            if headers or rows:
                node = {"type": "table", "headers": headers, "rows": rows}
                if caption:
                    node["caption"] = caption
                add(node, item)
                continue

        if kind in {"image", "chart", "table"}:
            image_path = _safe_output_image(output_root, item.get("img_path"))
            if image_path:
                visual_number += 1
                local_path = asset_dir / f"fig-{visual_number:04d}.webp"
                with Image.open(image_path) as image:
                    image.convert("RGB").save(local_path, "WEBP", quality=92, method=6)
                storage_path = f"{storage_base}/figures/{local_path.name}"
                upload_asset(local_path, storage_path, "image/webp")
                caption = _caption(item, "image_caption", "chart_caption", "table_caption") or f"Figure {visual_number}"
                page_index = item.get("page_idx")
                page = int(page_index) + 1 if isinstance(page_index, int) else None
                bounds = item.get("bbox") if isinstance(item.get("bbox"), list) else None
                assets.append(Asset("figure", visual_number, local_path, storage_path, page, caption, bounds=bounds))
                add({"type": "figure", "assetUrl": storage_path, "alt": caption, "caption": caption}, item)

    metadata: dict[str, Any] = {"title": title, "authors": []}
    if abstract:
        metadata["abstract"] = abstract
    if max_page:
        metadata["pageCount"] = max_page
    manifest = {
        "schemaVersion": 1,
        "metadata": metadata,
        "sections": sections,
        "references": [reference for reference in references if reference],
        "source": {"type": source_type, "filename": source_filename},
    }
    return manifest, assets


def extract_grobid_metadata(tei_xml: str) -> dict[str, Any]:
    namespace = {"tei": "http://www.tei-c.org/ns/1.0"}
    root = ElementTree.fromstring(tei_xml)
    title_node = root.find(".//tei:teiHeader/tei:fileDesc/tei:titleStmt/tei:title[@type='main']", namespace)
    title = _clean_text("".join(title_node.itertext())) if title_node is not None else ""
    authors: list[str] = []
    for person in root.findall(".//tei:teiHeader/tei:fileDesc/tei:sourceDesc//tei:analytic/tei:author/tei:persName", namespace):
        given = [_clean_text(node.text) for node in person.findall("tei:forename", namespace) if _clean_text(node.text)]
        surname = person.find("tei:surname", namespace)
        name = _clean_text(" ".join(given + ([_clean_text(surname.text)] if surname is not None else [])))
        if name and name not in authors:
            authors.append(name)
    abstract_node = root.find(".//tei:teiHeader/tei:profileDesc/tei:abstract", namespace)
    abstract = _clean_text(" ".join(abstract_node.itertext())) if abstract_node is not None else ""
    references: list[str] = []
    for bibliography in root.findall(".//tei:listBibl/tei:biblStruct", namespace):
        raw = bibliography.find("tei:note[@type='raw_reference']", namespace)
        text = _clean_text(" ".join(raw.itertext())) if raw is not None else _clean_text(" ".join(bibliography.itertext()))
        if text:
            references.append(text)
    return {"title": title, "authors": authors, "abstract": abstract, "references": references}


def merge_grobid_metadata(manifest: dict[str, Any], grobid: dict[str, Any] | None) -> dict[str, Any]:
    if not grobid:
        return manifest
    metadata = manifest["metadata"]
    current_title = _clean_text(metadata.get("title"))
    grobid_title = _clean_text(grobid.get("title"))
    similarity = SequenceMatcher(None, current_title.casefold(), grobid_title.casefold()).ratio() if current_title and grobid_title else 0
    filename_title = Path(manifest["source"]["filename"]).stem
    if grobid_title and (similarity >= 0.55 or current_title == filename_title or len(current_title) < 20):
        metadata["title"] = grobid_title
    if grobid.get("authors"):
        metadata["authors"] = grobid["authors"]
    if grobid.get("abstract") and not metadata.get("abstract"):
        metadata["abstract"] = grobid["abstract"]
    grobid_references = grobid.get("references", [])
    if grobid_references and len(grobid_references) >= len(manifest.get("references", [])):
        manifest["references"] = grobid_references
    return manifest


def validate_manifest(manifest: dict[str, Any], assets: list[Asset]) -> dict[str, Any]:
    sections = manifest.get("sections", [])
    counts = {kind: sum(1 for node in sections if node.get("type") == kind) for kind in ("heading", "paragraph", "formula", "table", "figure")}
    pages = [node["page"] for node in sections if isinstance(node.get("page"), int)]
    page_order_ok = all(left <= right for left, right in zip(pages, pages[1:]))
    labels = [str(node.get("label")) for node in sections if node.get("type") == "formula" and node.get("label")]
    numeric_labels = [int(label) for label in labels if label.isdigit()]
    equation_labels_continuous = not numeric_labels or numeric_labels == list(range(numeric_labels[0], numeric_labels[0] + len(numeric_labels)))
    visual_regions = [(asset.page_number, tuple(asset.bounds or [])) for asset in assets if asset.bounds]
    no_duplicate_visuals = len(visual_regions) == len(set(visual_regions))
    checks = {
        "has_title": bool(_clean_text(manifest.get("metadata", {}).get("title"))),
        "has_body": len(sections) >= 3,
        "page_order_monotonic": page_order_ok,
        "equation_labels_continuous": equation_labels_continuous,
        "no_duplicate_visual_regions": no_duplicate_visuals,
    }
    score = sum(1 for passed in checks.values() if passed) / len(checks)
    return {
        "score": round(score, 3),
        "checks": checks,
        "counts": counts | {"references": len(manifest.get("references", [])), "assets": len(assets)},
    }
