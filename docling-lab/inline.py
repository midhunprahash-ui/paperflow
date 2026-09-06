"""Conservative, source-backed inline presentation; never infer formula LaTeX.

Only single-location text blocks whose native and Docling characters agree are
eligible. The immutable extraction and plain-text section graph stay intact.
Native font/baseline evidence is saved alongside the rendered representation.
"""
from __future__ import annotations
from native_pdf import native_dict

from collections import Counter
import hashlib
import html
import json
from pathlib import Path
import re
import unicodedata


def compact(text):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', text))


def classify_script(size, baseline, flags, base_size, base_baseline):
    if flags & 1 and (size < base_size * .8 or baseline < base_baseline - .18*base_size):
        return 'sup'
    if size >= base_size * .8:
        return None
    offset = baseline - base_baseline
    if offset < -.18 * base_size:
        return 'sup'
    if offset > .025 * base_size:
        return 'sub'
    return 'ambiguous'


def styled_text(run):
    text = html.escape(run['text'], quote=False)
    # CommonMark still parses emphasis/code inside inline HTML containers.
    text = re.sub(r'[\\*_`\[\]~]', lambda m: f'&#{ord(m[0])};', text)
    if run['italic']:
        text = '<em>' + text + '</em>'
    if run['bold']:
        text = '<strong>' + text + '</strong>'
    if run['script'] in ('sub', 'sup'):
        text = f'<{run["script"]}>' + text + f'</{run["script"]}>'
    return text


def native_lines(page_data, box, glyphs=None):
    """Select characters, not whole spans which can extend into another block."""
    import pymupdf
    lines = []
    for block in page_data['blocks']:
        for line in block.get('lines', []):
            runs = []
            for span in line['spans']:
                chars = [c for c in span['chars'] if box.contains(pymupdf.Point(
                    (c['bbox'][0]+c['bbox'][2])/2, (c['bbox'][1]+c['bbox'][3])/2))]
                if not chars:
                    continue
                text = ''.join(c['c'] for c in chars)
                visible = [c for c in chars if c['c'].strip()] or chars
                rect = pymupdf.Rect(visible[0]['bbox'])
                for c in visible[1:]:
                    rect |= pymupdf.Rect(c['bbox'])
                ink = [glyphs.get(span['font'], span['size'], c) for c in visible if c['c'].strip()] if glyphs else []
                ink_rect = None
                if ink and all(b is not None for b in ink):
                    ink_rect = pymupdf.Rect(ink[0])
                    for b in ink[1:]: ink_rect |= pymupdf.Rect(b)
                runs.append(dict(text=text, font=span['font'], size=span['size'],
                                 flags=span['flags'], baseline=span['origin'][1],
                                 bbox=list(rect), ink_bbox=list(ink_rect) if ink_rect else None))
            if any(r['text'].strip() for r in runs):
                lines.append(dict(runs=runs, direction=list(line['dir'])))
    return lines


def drawing_bounds(drawing):
    """MuPDF's drawing rect can omit an arrowhead: include every path point."""
    import pymupdf
    rect = pymupdf.Rect(drawing['rect'])
    for item in drawing['items']:
        for value in item[1:]:
            if isinstance(value, pymupdf.Point):
                rect.x0 = min(rect.x0, value.x); rect.x1 = max(rect.x1, value.x)
                rect.y0 = min(rect.y0, value.y); rect.y1 = max(rect.y1, value.y)
            elif isinstance(value, pymupdf.Rect):
                rect |= value
            elif isinstance(value, pymupdf.Quad):
                rect |= value.rect
    return rect


def overlapping_lines(lines):
    """Stacked math sometimes appears as multiple overlapping extraction lines.

    Rendering those independently duplicates pixels and gives false word order.
    Leave the existing export intact until physical-line reconstruction is proven.
    """
    import pymupdf
    bounds = []
    for line in lines:
        visible = [r for r in line['runs'] if r['text'].strip()]
        if not visible:
            continue
        box = pymupdf.Rect(visible[0]['bbox'])
        for run in visible[1:]:
            box |= pymupdf.Rect(run['bbox'])
        for other in bounds:
            overlap = box & other
            if overlap.width > 0 and overlap.height > .35 * min(box.height, other.height):
                return True
        bounds.append(box)
    return False


def reconstruct_lines(lines, base_size):
    """Join consecutive extraction fragments with the same physical baseline.

    Keep extraction order within an expression: sorting simultaneous super/sub
    scripts by x would arbitrarily change their text alternative.
    """
    from copy import deepcopy
    result = []
    for original in lines:
        line = deepcopy(original)
        weights = Counter()
        for run in line['runs']:
            if run['text'].strip() and run['size'] >= .8*base_size and not run['flags'] & 1:
                weights[round(run['baseline'], 2)] += len(run['text'].strip())
        baseline = weights.most_common(1)[0][0] if weights else None
        if result and (baseline is None or abs(baseline-result[-1]['anchor_baseline']) < .6*base_size):
            # A small detached fraction belongs to the preceding row only when
            # it is vertically close; never bridge a paragraph-sized gap.
            y = baseline if baseline is not None else max(r['baseline'] for r in line['runs'])
            if abs(y-result[-1]['anchor_baseline']) < .7*base_size:
                result[-1]['runs'].extend(line['runs'])
                result[-1]['merged_fragments'] += 1
                continue
        line['anchor_baseline'] = baseline if baseline is not None else max(r['baseline'] for r in line['runs'])
        line['merged_fragments'] = 1
        result.append(line)
    return result


def annotate_line(line, base_size):
    runs = line['runs']
    weights = Counter()
    for run in runs:
        if run['size'] >= .8 * base_size and not run['flags'] & 1:
            weights[round(run['baseline'], 2)] += len(run['text'].strip())
    base_baseline = weights.most_common(1)[0][0] if weights else None
    for run in runs:
        run['bold'] = bool(run['flags'] & 16 or re.search(r'Bold|Demi|Medi', run['font'], re.I))
        run['italic'] = bool(run['flags'] & 2 or re.search(r'Ital|Oblique', run['font'], re.I))
        run['script'] = classify_script(run['size'], run['baseline'], run['flags'], base_size, base_baseline) if base_baseline is not None else 'ambiguous'
        run['math_font'] = bool(re.search(r'math|cmsy|cmmi|cmex|symbol|msam|msbm', run['font'], re.I))
    line['base_size'] = base_size
    line['baseline'] = base_baseline if base_baseline is not None else max(r['baseline'] for r in runs)


def render_line(line, page, drawings, assets, stem, line_no):
    import pymupdf
    runs = line['runs']
    pieces, crops = [], []
    i = 0
    while i < len(runs):
        run = runs[i]
        special = lambda r: r['bold'] or r['italic'] or r['script'] or r['math_font'] or not r['text'].strip()
        if not special(run):
            pieces.append(styled_text(run)); i += 1
            continue
        end = i + 1
        while end < len(runs) and special(runs[end]):
            end += 1
        group = runs[i:end]
        visible = [r for r in group if r['text'].strip()] or group
        rect = pymupdf.Rect(visible[0].get('ink_bbox') or visible[0]['bbox'])
        for r in visible[1:]:
            rect |= pymupdf.Rect(r.get('ink_bbox') or r['bbox'])
        nearby = [r for r in drawings if 0 < r.width < 4*line['base_size']
                  and r.height < 1.3*line['base_size']
                  and r.intersects(rect + (-1, -3, 1, 1))]
        reasons = []
        if nearby:
            reasons.append('drawn_marks_near_text')
        if any(r['math_font'] for r in group):
            reasons.append('math_font_glyph_fidelity')
        if any(r['script'] == 'ambiguous' for r in group):
            reasons.append('ambiguous_small_text_baseline')
        if reasons and any(r['text'].strip() for r in group):
            for r in nearby:
                rect |= r
            # Tight crops avoid bringing in the preceding line or next word.
            # Native glyph boxes already include font ascender/descender space.
            rect = (rect + (0, -.05, 0, .05)) & page.rect
            name = f'{stem}-line-{line_no}-run-{i}.png'
            page.get_pixmap(matrix=pymupdf.Matrix(4, 4), clip=rect, alpha=False).save(assets/name)
            source_text = ''.join(r['text'] for r in group)
            width = rect.width / line['base_size']
            descent = max(0, rect.y1-line['baseline']) / line['base_size']
            # alt is explicitly an unverified text alternative: drawings are absent
            # from the native string. No claim of accessible formula semantics.
            alt = 'Original inline expression; unverified text: ' + source_text.strip()
            tag = (f'<img class="inline-source" src="assets/{name}" '
                   f'alt="{html.escape(alt, quote=True)}" '
                   f'style="width:{width:.4f}em;max-width:100%;height:auto;vertical-align:-{descent:.4f}em">')
            pieces.append((' ' if source_text[:1].isspace() else '') + tag +
                          (' ' if source_text[-1:].isspace() else ''))
            crops.append(dict(asset=f'assets/{name}', bbox=list(rect), reasons=reasons,
                              text_alternative=source_text, text_verified=False,
                              drawing_bounds=[list(r) for r in nearby],
                              line=line_no, run_start=i, run_end=end))
        else:
            pieces.extend(styled_text(r) for r in group)
        i = end
    return ''.join(pieces), crops


def enrich_inline(doc, pdf, out: Path, md: str):
    """Return Markdown plus a manifest keyed by stable document block IDs."""
    import pymupdf
    from docling_core.transforms.serializer.markdown import MarkdownDocSerializer
    serializer = MarkdownDocSerializer(doc=doc)
    from glyphs import GlyphBounds
    glyphs = GlyphBounds(pdf)
    pages, drawings = {}, {}
    blocks, skipped, fixes = [], [], []
    for item, _ in doc.iterate_items():
        if item.label.value != 'text' or not item.text or item.hyperlink or item.children:
            continue
        if len(item.prov) != 1:
            skipped.append(dict(id=item.self_ref, reason='multiple_or_missing_source_locations'))
            continue
        prov = item.prov[0]; page_no = prov.page_no
        page = pdf[page_no-1]
        if page_no not in pages:
            pages[page_no] = native_dict(page, raw=True)
            drawings[page_no] = [drawing_bounds(d) for d in page.get_drawings()]
        b = prov.bbox.to_top_left_origin(page.rect.height)
        lines = native_lines(pages[page_no], pymupdf.Rect(b.l-1, b.t-2, b.r+1, b.b+2), glyphs)
        native_text = ' '.join(''.join(r['text'] for r in l['runs']).strip() for l in lines)
        if not native_text.strip():
            skipped.append(dict(id=item.self_ref, page=page_no, reason='no_native_text'))
            continue
        if compact(native_text) != compact(item.text):
            skipped.append(dict(id=item.self_ref, page=page_no, reason='source_text_alignment_mismatch'))
            continue
        if any(abs(l['direction'][0]-1)>.001 or abs(l['direction'][1])>.001 for l in lines):
            skipped.append(dict(id=item.self_ref, page=page_no, reason='rotated_text'))
            continue
        size_weights = Counter()
        for line in lines:
            for run in line['runs']:
                size_weights[round(run['size'], 2)] += len(run['text'].strip())
        base_size = size_weights.most_common(1)[0][0]
        lines = reconstruct_lines(lines, base_size)
        for line in lines:
            annotate_line(line, base_size)
        runs = [r for l in lines for r in l['runs'] if r['text'].strip()]
        styles = {(r['bold'], r['italic'], r['script'], r['math_font']) for r in runs}
        if len(styles) == 1 and not any(r['script'] or r['math_font'] for r in runs):
            # Uniform paragraph formatting already belongs to Docling's exporter.
            continue
        original = serializer.serialize(item=item).text
        pattern = re.compile(r'(?<![^\n])' + re.escape(original) + r'(?=\n\n|\Z)')
        if len(list(pattern.finditer(md))) != 1:
            skipped.append(dict(id=item.self_ref, page=page_no, reason='export_block_not_unique'))
            continue
        fragments, crops = [], []
        stem = 'inline-' + item.self_ref.replace('#/', '').replace('/', '-')
        for number, line in enumerate(lines):
            fragment, images = render_line(line, page, drawings[page_no], out/'assets', stem, number)
            fragments.append(fragment.strip()); crops.extend(images)
        rendered = '<span class="source-inline" data-block-id="'+html.escape(item.self_ref, quote=True)+'">' + ' '.join(fragments) + '</span>'
        md = pattern.sub(lambda _: rendered, md, count=1)
        blocks.append(dict(id=item.self_ref, page=page_no, original_text=item.text,
                           native_text=native_text, html=rendered, lines=lines,
                           source_crops=crops, alignment='equal_after_nfkc_and_whitespace_removal',
                           status='source_backed_needs_review'))
        fixes.append(dict(kind='native_inline_presentation', id=item.self_ref, page=page_no,
                          source_crops=len(crops)))
    manifest = dict(schema_version=1, source_sha256=hashlib.sha256(Path(pdf.name).read_bytes()).hexdigest(),
                    status='experimental', blocks=blocks, skipped=skipped,
                    limits='Native single-location paragraphs only. Exact normalized character alignment is a gate, not a fidelity score. Headings, lists, captions, tables and multi-location paragraphs retain their existing export. Scans have no native formatting evidence. Drawn marks, math-font glyphs and ambiguous small text use recorded source crops; crop text alternatives are unverified. No inferred LaTeX or semantic math claims.')
    (out/'inline-content.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    return md, manifest, fixes
