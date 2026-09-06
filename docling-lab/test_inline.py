import json
from copy import deepcopy
from pathlib import Path

import pytest

from audit_inline import InlineHTML, check_gold, compact
from inline import annotate_line, classify_script, drawing_bounds, overlapping_lines, styled_text

ROOT = Path(__file__).resolve().parent
USER = ROOT/'outputs/formulas-cached/camera-ready'


def test_script_geometry_and_ambiguous_small_text():
    assert classify_script(6.48, 173.28, 22, 10.08, 172.8) == 'sub'
    assert classify_script(6.48, 304.8, 20, 10.08, 308.4) == 'sup'
    assert classify_script(6.48, 308.4, 21, 10.08, 308.4) == 'sup'
    assert classify_script(6.48, 308.4, 20, 10.08, 308.4) == 'ambiguous'
    assert classify_script(10.08, 308.4, 20, 10.08, 308.4) is None


def test_long_subscript_on_short_line_uses_paragraph_base_size():
    # Source line "of F_bilstm": most letters on this line are subscript.
    line = {'runs': [dict(text=text, size=size, baseline=y, flags=flags, font='Times')
                     for text,size,y,flags in [('of ',10.08,562.32,4), ('F',10.08,562.32,22), ('bilstm',6.48,562.8,22)]]}
    annotate_line(line, 10.08)
    assert line['runs'][-1]['script'] == 'sub'


def test_drawn_arrow_bounds_include_arrowhead_outside_reported_rect():
    import pymupdf as m
    drawing = dict(rect=m.Rect(10,10,20,10.5), items=[('l',m.Point(18,8),m.Point(22,10)), ('l',m.Point(22,10),m.Point(18,12))])
    rect = drawing_bounds(drawing)
    assert rect.x1 == 22 and rect.y0 == 8 and rect.y1 == 12


def test_overlapping_extraction_lines_are_not_rendered_as_separate_crops():
    lines = [{'runs':[{'text':'a superscript', 'bbox':[220,136,230,147]}]},
             {'runs':[{'text':'subscript and prose', 'bbox':[227,137,504,149]}]}]
    assert overlapping_lines(lines)
    lines[1]['runs'][0]['bbox'] = [220,149,504,160]
    assert not overlapping_lines(lines)


def test_markup_cannot_change_native_characters_or_inject_html():
    from markdown_it import MarkdownIt
    source = '<script>alert(1)</script> *literal* _x_ `code` [link](x) & \\alpha'
    rendered = '<span>' + styled_text(dict(text=source, italic=False, bold=False, script=None)) + '</span>'
    output = MarkdownIt('commonmark', {'html':True}).render(rendered)
    assert ''.join(InlineHTML(output).text).strip() == source
    assert '<script>' not in output and '<em>' not in output and '<code>' not in output and '<a ' not in output


def read_inline():
    if not (USER/'inline-content.json').exists():
        pytest.skip('Build the user review first')
    return json.loads((USER/'inline-content.json').read_text())


def test_all_thirteen_source_reviewed_math_prose_blocks():
    result = check_gold(read_inline(), json.loads((ROOT/'camera-ready-inline.json').read_text()), (USER/'paper.md').read_text(), USER)
    assert result['checked_prose_blocks'] == 13
    assert result['failures'] == []


def test_inline_audit_rejects_flattening_missing_arrows_and_wrong_source():
    original = read_inline(); gold = json.loads((ROOT/'camera-ready-inline.json').read_text())
    md = (USER/'paper.md').read_text()
    flattened = deepcopy(original)
    block = next(b for b in flattened['blocks'] if b['id']=='#/texts/102')
    block['html'] = block['html'].replace('<sub>', '').replace('</sub>', '')
    assert check_gold(flattened, gold, md, USER)['status'] == 'fail'
    no_arrows = deepcopy(original)
    next(b for b in no_arrows['blocks'] if b['id']=='#/texts/112')['source_crops'][0]['drawing_bounds'] = []
    assert check_gold(no_arrows, gold, md, USER)['status'] == 'fail'
    wrong_source = deepcopy(original); wrong_source['source_sha256'] = '0'*64
    assert check_gold(wrong_source, gold, md, USER)['status'] == 'fail'


def test_crop_pixels_match_recorded_source_bounds_and_keep_arrows():
    import pymupdf as m
    manifest = read_inline()
    with m.open(ROOT/'inputs/camera-ready.pdf') as pdf:
        for block in manifest['blocks']:
            for crop in block['source_crops']:
                rect = m.Rect(crop['bbox'])
                expected = pdf[block['page']-1].get_pixmap(matrix=m.Matrix(4,4), clip=rect, alpha=False)
                actual = m.Pixmap(str(USER/crop['asset']))
                assert expected.samples == actual.samples
                for drawing in crop['drawing_bounds']:
                    assert rect.contains(m.Rect(drawing))
                if block['id']=='#/texts/112':
                    # The preceding line baseline is 471.84; its ink must stay out.
                    assert rect.y0 > 471.84 and rect.y0 < 472.14


def test_corpus_inline_characters_assets_and_section_links():
    from markdown_it import MarkdownIt
    results_path = ROOT/'results.json'
    if not results_path.exists():
        pytest.skip('Build the corpus first')
    for result in json.loads(results_path.read_text()):
        out = ROOT/result['output']
        data = json.loads((out/'inline-content.json').read_text())
        md = (out/'paper.md').read_text()
        graph = json.loads((out/'structure.json').read_text())
        blocks = {b['id']:b for b in graph['blocks']}
        for block in data['blocks']:
            assert md.count(block['html']) == 1
            # Verify actual CommonMark rendering, not just our generated tags.
            rendered = MarkdownIt('commonmark', {'html':True}).render(block['html'])
            assert compact(''.join(InlineHTML(rendered).text)) == compact(block['original_text'])
            assert blocks[block['id']]['inline_content']['block_id'] == block['id']
            assert blocks[block['id']]['text'] == block['original_text']
            for crop in block['source_crops']:
                assert (out/crop['asset']).is_file() and crop['text_verified'] is False
        if result['case'].endswith('-scan'):
            assert not data['blocks']
