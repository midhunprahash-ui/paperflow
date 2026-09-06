import json
from pathlib import Path
import pytest
from app_export import export_app,InlineParser

ROOT=Path(__file__).resolve().parent

def test_every_current_corpus_block_keeps_its_order_owner_and_assets():
    cases=json.loads((ROOT/'results.json').read_text())
    assert len(cases)==12
    for case in cases:
        out=ROOT/case['output'];m=export_app(out);g=json.loads((out/'structure.json').read_text())
        assert [b['sourceId'] for b in m['sections']]==[b['id'] for b in g['blocks']]
        assert [b['sectionPath'] for b in m['sections']]==[b['section_path'] for b in g['blocks']]
        assert len(m['hierarchy'])==len(g['sections'])
        assert all((out/a['path']).is_file() for a in m['assets'].values())
        assert all(b['sourceAsset'] and not b['latex'] for b in m['sections'] if b['type']=='formula')
        assert all(b.get('sourceAsset') for b in m['sections'] if b['type']=='figure')
        if case['case']=='camera-ready':assert len(m['sections'])==137 and len(m['hierarchy'])==19
        if case['case']=='resnet':
            t=next(b for b in m['sections'] if b['sourceId']=='#/tables/0')
            assert (t['rowCount'],t['colCount'],len(t['cells']))==(9,7,48)
            assert all(c.get('sourceAsset') for c in t['cells'])

def test_inline_export_is_typed_and_rejects_active_markup():
    p=InlineParser(lambda path:path)
    p.feed('<span>safe &lt;script&gt;<strong>x<sub>2</sub></strong><img src="assets/math.png" style="width:2em;vertical-align:-0.2em"></span>')
    assert p.parts[0]['text']=='safe <script>'
    assert p.parts[1]['bold'] and p.parts[2]['script']=='sub'
    assert p.parts[3]['widthEm']==2 and p.parts[3]['descentEm']==.2
    with pytest.raises(ValueError):InlineParser(lambda p:p).feed('<script>alert(1)</script>')

def test_native_font_evidence_omits_images_without_changing_text(tmp_path):
    import pymupdf as m
    from native_pdf import native_dict
    with m.open(ROOT/'inputs/camera-ready-mixed.pdf') as pdf:
        for page in [pdf[0],pdf[1]]:
            for raw in [False,True]:
                original=page.get_text('rawdict' if raw else 'dict')
                actual=native_dict(page,raw=raw)
                assert actual['blocks']==[b for b in original['blocks'] if b['type']==0]

def test_duplicate_scanned_heading_requires_independent_line_evidence():
    import pymupdf
    from docling_core.types.doc import DoclingDocument
    from ocr_structure import repair_ocr_structure
    out=ROOT/'outputs/ocr-ordered/camera-ready-scan'
    lines=json.loads((out/'ocr-lines.json').read_text())
    for evidence,should_repair in [(lines,True),([],False),([{**l,'confidence':.5} for l in lines],False),([{**l,'text':l['text']+' extra'} for l in lines],False)]:
        doc=DoclingDocument.load_from_json(out/'raw.json')
        heading=next(t for t in doc.texts if t.label.value=='section_header' and t.text.startswith('VI. LIMITATIONS'))
        original='VI. LIMITATIONS & DEPLOYMENT SAFEGAURDS'
        heading.text=original+' '+original
        with pymupdf.open(ROOT/'inputs/camera-ready-scan.pdf') as pdf:repair_ocr_structure(doc,pdf,evidence)
        assert heading.text==(original if should_repair else original+' '+original)
