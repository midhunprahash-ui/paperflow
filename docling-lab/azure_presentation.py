"""Recover font emphasis only when native PDF characters agree with Azure OCR.

This is a deterministic presentation pass, not a second document parser/model.
Scans and text mismatches retain Azure's plain text. Equation crops stay intact.
"""
import re
import unicodedata
import json
from pathlib import Path
import pymupdf
from inline import native_lines
from native_pdf import native_dict

rules_path = Path(__file__).with_name('formula-heading-rules.json')
if not rules_path.exists():
    rules_path = Path(__file__).resolve().parent.parent / 'src/lib/formula-heading-rules.json'
HEADING_LABELS = json.loads(rules_path.read_text())


def known_heading(text):
    """Only standalone vocabulary matches, never expressions containing words."""
    if len(text) > 256:
        return None
    plain = re.sub(r'\\(?:mathrm|mathbf|mathit|text|textrm|textbf|textit)\s*\{([^{}]*)\}', r'\1', text).strip()
    if not re.fullmatch(r'[A-Za-z\d\s.()]+', plain):
        return None
    match = re.match(r'^((?:[IVXLCDM]\s*)+|[A-Z]|\d+(?:\.\d+)*)\s*[.)]\s*(.+)$', plain)
    key = characters(match[2] if match else plain).lower()
    for label, aliases in HEADING_LABELS.items():
        if any(characters(alias).lower() == key for alias in [label, *aliases]):
            return f'{characters(match[1])}. {label}' if match else label
    return None


def characters(text):
    return ''.join(c for c in unicodedata.normalize('NFKC', text) if not c.isspace())


class NativeEmphasis:
    def __init__(self, pdf, pages):
        self.pdf = pdf
        self.pages = pages
        self.cache = {}

    def lines(self, item):
        regions = item.get('boundingRegions', [])
        if len(regions) != 1:
            return []
        region = regions[0]
        number = region['pageNumber']
        info = self.pages[number]
        page = self.pdf[number - 1]
        polygon = region['polygon']
        if len(polygon) < 8 or len(polygon) % 2 or info['width'] <= 0 or info['height'] <= 0:
            return []
        xs = [x * page.rect.width / info['width'] for x in polygon[::2]]
        ys = [y * page.rect.height / info['height'] for y in polygon[1::2]]
        box = pymupdf.Rect(min(xs), min(ys), max(xs), max(ys))
        if number not in self.cache:
            self.cache[number] = native_dict(page, raw=True)
        return native_lines(self.cache[number], box)

    def text(self, item):
        return ' '.join(''.join(run['text'] for run in line['runs']) for line in self.lines(item))

    def inline(self, item):
        text = item.get('content', '')
        if ':formula:' in text:
            return None
        evidence = []
        native = []
        for line in self.lines(item):
            for run in line['runs']:
                chars = characters(run['text'])
                style = (bool(run['flags'] & 16 or re.search(r'Bold|Demi', run['font'], re.I)),
                         bool(run['flags'] & 2 or re.search(r'Ital|Oblique', run['font'], re.I)))
                native.append(chars)
                evidence.extend([style] * len(chars))
        if not evidence or ''.join(native) != characters(text) or not any(any(s) for s in evidence):
            return None
        parts = []
        cursor = 0
        for char in text:
            count = len(characters(char))
            styles = evidence[cursor:cursor + count]
            # A compatibility character can expand to several letters. Only use
            # emphasis when every corresponding source character agrees.
            style = styles[0] if styles and all(s == styles[0] for s in styles) else (False, False)
            cursor += count
            if char.isspace() and parts:
                parts[-1]['text'] += char
                continue
            if parts and (parts[-1].get('bold', False), parts[-1].get('italic', False)) == style:
                parts[-1]['text'] += char
            else:
                parts.append(dict(type='text', text=char, bold=style[0], italic=style[1]))
        return parts


def heading_level(text, inside_lettered_section):
    # Standalone C/D/L are typically lettered subsections, not Roman sections.
    if re.match(r'^(?:[IVX]|[IVXLCDM]{2,})[.)]\s', text):
        return 1, False
    if re.match(r'^[A-Z][.)]\s', text):
        return 2, True
    if inside_lettered_section and re.match(r'^\d+\)\s', text):
        return 3, True
    number = re.match(r'^(\d+(?:\.\d+)*)[.\s]', text)
    return (min(6, len(number[1].split('.'))) if number else 1), inside_lettered_section
