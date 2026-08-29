from pathlib import Path

from normalizer import (
    extract_grobid_metadata,
    merge_grobid_metadata,
    normalize_document,
    normalize_mineru_content,
    validate_manifest,
)


class Label:
    def __init__(self, value):
        self.value = value


class Item:
    def __init__(self, label, text, level=1):
        self.label = Label(label)
        self.text = text
        self.level = level
        self.prov = []


class Document:
    pages = {1: object()}

    def iterate_items(self):
        yield Item("title", "A Carefully Parsed Paper"), 0
        yield Item("section_header", "Introduction", 1), 0
        yield Item("text", "All of the body text is retained."), 1
        yield Item("formula", r"E=mc^2"), 1
        yield Item("reference", "A. Author. Prior work."), 1


class NestedDocument:
    pages = {1: object()}

    def iterate_items(self):
        yield Item("section_header", "1.2 Related Work", None), 1
        yield Item("section_header", "Implementation details", None), 3


def test_normalizes_core_document_nodes(tmp_path: Path):
    manifest, assets = normalize_document(
        Document(),
        source_type="pdf",
        source_filename="paper.pdf",
        asset_dir=tmp_path,
        storage_base="owner/documents/doc_1/versions/v0001",
        upload_asset=lambda *_args: None,
    )
    assert manifest["metadata"]["title"] == "A Carefully Parsed Paper"
    assert manifest["metadata"]["pageCount"] == 1
    assert [node["type"] for node in manifest["sections"]] == ["heading", "paragraph", "formula"]
    assert manifest["references"] == ["A. Author. Prior work."]
    assert assets == []


def test_preserves_numbered_and_docling_heading_depth(tmp_path: Path):
    manifest, _assets = normalize_document(
        NestedDocument(),
        source_type="pdf",
        source_filename="paper.pdf",
        asset_dir=tmp_path,
        storage_base="owner/documents/doc_1/versions/v0001",
        upload_asset=lambda *_args: None,
    )

    assert [node["level"] for node in manifest["sections"]] == [2, 3]


def test_normalizes_mineru_scientific_content_and_original_figure(tmp_path: Path):
    from PIL import Image

    output_root = tmp_path / "mineru"
    output_root.mkdir()
    asset_dir = tmp_path / "assets"
    asset_dir.mkdir()
    Image.new("RGB", (20, 10), "white").save(output_root / "figure.png")
    uploaded: list[tuple[str, str, str]] = []
    content = [
        {"type": "text", "text": "A Better Paper", "text_level": 1, "page_idx": 0},
        {"type": "text", "text": "Abstract: A complete abstract.", "page_idx": 0},
        {"type": "text", "text": "I. INTRODUCTION", "text_level": 1, "page_idx": 0},
        {"type": "equation", "text": r"x \in R \tag{1}", "page_idx": 0},
        {
            "type": "table",
            "table_caption": ["Table I. Results"],
            "table_body": "<table><tr><th>Model</th><th>F1</th></tr><tr><td>Ours</td><td>0.91</td></tr></table>",
            "page_idx": 1,
        },
        {
            "type": "image",
            "img_path": "figure.png",
            "image_caption": ["Fig. 1. Architecture"],
            "bbox": [10, 20, 30, 40],
            "page_idx": 1,
        },
        {"type": "text", "text": "REFERENCES", "page_idx": 1},
        {"type": "list", "sub_type": "ref_text", "list_items": ["[1] Prior work"], "page_idx": 1},
    ]

    manifest, assets = normalize_mineru_content(
        content,
        source_type="pdf",
        source_filename="paper.pdf",
        output_root=output_root,
        asset_dir=asset_dir,
        storage_base="owner/documents/doc_1/versions/v0001",
        upload_asset=lambda path, storage, media: uploaded.append((path.name, storage, media)),
    )

    assert manifest["metadata"] == {"title": "A Better Paper", "authors": [], "abstract": "A complete abstract.", "pageCount": 2}
    assert [node["type"] for node in manifest["sections"]] == ["heading", "formula", "table", "figure"]
    assert manifest["sections"][1]["latex"] == r"x \in R"
    assert manifest["sections"][1]["label"] == "1"
    assert manifest["sections"][2]["headers"] == ["Model", "F1"]
    assert manifest["references"] == ["Prior work"]
    assert assets[0].bounds == [10, 20, 30, 40]
    assert uploaded[0][2] == "image/webp"


def test_grobid_repairs_metadata_and_references():
    tei = """<TEI xmlns="http://www.tei-c.org/ns/1.0"><teiHeader><fileDesc>
      <titleStmt><title type="main">A Better Paper</title></titleStmt><sourceDesc><biblStruct><analytic>
      <author><persName><forename>Jane</forename><surname>Doe</surname></persName></author>
      </analytic></biblStruct></sourceDesc></fileDesc><profileDesc><abstract>Useful abstract.</abstract></profileDesc>
      </teiHeader><text><back><listBibl>
      <biblStruct><note type="raw_reference">[1] First reference.</note></biblStruct>
      <biblStruct><note type="raw_reference">[2] Second reference.</note></biblStruct>
      <biblStruct><note type="raw_reference">[3] Third reference.</note></biblStruct>
      </listBibl></back></text></TEI>"""
    parsed = extract_grobid_metadata(tei)
    manifest = {
        "metadata": {"title": "paper", "authors": []},
        "sections": [{"type": "paragraph", "text": "Body"}],
        "references": [],
        "source": {"type": "pdf", "filename": "paper.pdf"},
    }

    merged = merge_grobid_metadata(manifest, parsed)

    assert merged["metadata"]["title"] == "A Better Paper"
    assert merged["metadata"]["authors"] == ["Jane Doe"]
    assert merged["metadata"]["abstract"] == "Useful abstract."
    assert len(merged["references"]) == 3


def test_quality_validation_detects_duplicate_visual_regions():
    manifest = {
        "metadata": {"title": "Paper"},
        "sections": [
            {"type": "heading", "page": 1},
            {"type": "paragraph", "page": 1},
            {"type": "formula", "page": 2, "label": "1"},
        ],
        "references": [],
    }
    from normalizer import Asset

    assets = [
        Asset("figure", 1, Path("one"), "one", 1, None, bounds=[1, 2, 3, 4]),
        Asset("figure", 2, Path("two"), "two", 1, None, bounds=[1, 2, 3, 4]),
    ]

    quality = validate_manifest(manifest, assets)

    assert quality["checks"]["no_duplicate_visual_regions"] is False
    assert quality["counts"]["formula"] == 1
