from pathlib import Path

from normalizer import normalize_document


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
