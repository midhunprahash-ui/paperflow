from pathlib import Path
from types import SimpleNamespace
import hashlib
import json
import re

import pytest

from inline import classify_script,compact
from parse_pdf import conversion_issues,inspect_pdf,normalize_page_rotation
from tables import occupancy,ruled_grid

ROOT=Path(__file__).resolve().parent


def test_invalid_empty_and_non_pdf_inputs(tmp_path):
    for name,content in [('empty.pdf',b''),('corrupt.pdf',b'%PDF-1.7\nnot a valid document')]:
        path=tmp_path/name;path.write_bytes(content)
        with pytest.raises(ValueError,match='Invalid or empty PDF'):inspect_pdf(path)
    path=tmp_path/'image.pdf';path.write_bytes(b'P6\n1 1\n255\n\xff\xff\xff')
    with pytest.raises(ValueError,match='must be a PDF'):inspect_pdf(path)


def test_blank_document_is_rejected_before_models(tmp_path):
    import pymupdf as m
    path=tmp_path/'blank.pdf'
    with m.open() as doc:doc.new_page();doc.save(path)
    with pytest.raises(ValueError,match='no visible content'):inspect_pdf(path)


def test_partial_conversion_and_missing_pages_cannot_report_success():
    from docling.datamodel.base_models import ConversionStatus
    doc=SimpleNamespace(pages={1:None},iterate_items=lambda:iter([('content',0)]))
    assert 'conversion_status_not_success' in conversion_issues(ConversionStatus.PARTIAL_SUCCESS,doc,1)
    assert 'converted_page_inventory_mismatch' in conversion_issues(ConversionStatus.SUCCESS,doc,2)
    doc.iterate_items=lambda:iter([])
    assert 'conversion_has_no_content_blocks' in conversion_issues(ConversionStatus.SUCCESS,doc,1)


def test_rotation_normalization_preserves_uploaded_bytes(tmp_path):
    import pymupdf as m
    source=ROOT/'outputs/edge-inputs/math-rotate-90.pdf'
    if not source.exists():pytest.skip('Create the rotation corpus first')
    before=hashlib.sha256(source.read_bytes()).hexdigest()
    normalized=normalize_page_rotation(source,tmp_path,[90])
    with m.open(normalized) as pdf:assert pdf[0].rotation==0
    assert hashlib.sha256(source.read_bytes()).hexdigest()==before
    with pytest.raises(ValueError,match='already exists'):normalize_page_rotation(source,tmp_path,[90])


def test_all_three_rotation_runs_keep_the_same_math_and_hierarchy():
    outputs=[ROOT/f'outputs/edge-cases/math-rotate-{angle}' for angle in [0,90,180]]
    if not all((p/'quality.json').exists() for p in outputs):pytest.skip('Run rotation cases first')
    inventories=[]
    for out in outputs:
        run=json.loads((out/'run.json').read_text());doc=json.loads((out/'structure.json').read_text())
        assert run['state']=='converted' and not run['conversion_issues']
        assert (out/'paper.md').read_text().count('![Original equation,')==6
        inventories.append([(b['kind'],b['text'],b['section_path']) for b in doc['blocks']])
    assert inventories[0]==inventories[1]==inventories[2]


def test_spurious_full_size_superscript_flag_does_not_raise_prose():
    assert classify_script(9.96,145.22,1,9.96,145.22) is None


def test_three_formerly_skipped_math_paragraphs_are_complete():
    for name,ids in [('alexnet',[47]),('attention',[88,92])]:
        out=ROOT/f'outputs/formulas-cached/{name}';data=json.loads((out/'inline-content.json').read_text())
        for number in ids:
            block=next(b for b in data['blocks'] if b['id']==f'#/texts/{number}')
            assert (out/'paper.md').read_text().count(block['html'])==1
            assert all('the activity of a neuron' not in c['text_alternative'] for c in block['source_crops'])
            if name=='alexnet':
                alternatives=[compact(c['text_alternative']) for c in block['source_crops']]
                assert 'aix,y' in alternatives and 'bix,y' in alternatives
            if number==88:
                root=next(c for c in block['source_crops'] if '√' in c['text_alternative'])
                assert root['bbox'][1]>390.7 # excludes the preceding text row
            if number==92:
                assert sum(compact(c['text_alternative'])=='1√dk' for c in block['source_crops'])==1


def test_resnet_architecture_table_source_grid_and_spans():
    out=ROOT/'outputs/formulas-cached/resnet';data=json.loads((out/'table-content.json').read_text())
    repair=data['repairs']['#/tables/0'];cells=repair['cells']
    assert len(repair['grid_lines']['x'])==8 and len(repair['grid_lines']['y'])==10
    assert len(cells)==48
    by_position={(c['row'],c['col']):c for c in cells}
    assert [by_position[0,c]['text'] for c in range(7)]==['layer name','output size','18-layer','34-layer','50-layer','101-layer','152-layer']
    assert by_position[1,2]['col_span']==5
    assert by_position[2,0]['row_span']==by_position[2,1]['row_span']==2
    assert by_position[8,0]['col_span']==2
    assert '23' in by_position[5,5]['text'] and '36' in by_position[5,6]['text']
    assert not next(a for a in data['audit'] if a['id']=='#/tables/0')['errors']
    assert all((out/c['source_image']).is_file() for c in cells)


def test_paired_table_rules_do_not_create_fake_empty_rows():
    import pymupdf as m
    from docling_core.types.doc import DoclingDocument
    with m.open(ROOT/'inputs/alexnet.pdf') as pdf:
        doc=DoclingDocument.load_from_json(ROOT/'outputs/formulas-cached/alexnet/raw.json')
        for table,rows,cols in zip(doc.tables,[4,6],[3,4]):
            p=table.prov[0];page=pdf[p.page_no-1];b=p.bbox.to_top_left_origin(page.rect.height)
            grid=ruled_grid(page,m.Rect(b.l,b.t,b.r,b.b))
            assert (grid['num_rows'],grid['num_cols'])==(rows,cols)


def test_cell_audit_catches_overlap_and_out_of_range_spans():
    from docling_core.types.doc import TableCell,TableData
    c=TableCell(text='1',start_row_offset_idx=0,end_row_offset_idx=1,start_col_offset_idx=0,end_col_offset_idx=1)
    assert occupancy(TableData(num_rows=1,num_cols=1,table_cells=[c,c]))
    c.end_col_offset_idx=2
    assert occupancy(TableData(num_rows=1,num_cols=1,table_cells=[c]))


def test_native_numeric_cell_audit():
    from audit_numeric_cells import audit
    result=audit()
    assert result['checked_cells']>=500 and not result['failures']


def test_scanned_paper_passes_complete_source_inventory():
    from audit_structure import audit,read_gold
    path=ROOT/'outputs/ocr-ordered/camera-ready-scan/structure.json'
    if not path.exists():pytest.skip('Run ordered OCR first')
    result=audit(json.loads(path.read_text()),read_gold())
    assert result['actual_blocks']==137 and result['failures']==[]


def test_scanned_reference_continuations_and_equation_label_evidence():
    data=json.loads((ROOT/'outputs/ocr-ordered/camera-ready-scan/structure.json').read_text())
    refs={b['marker']:b for b in data['blocks'] if b['kind']=='list_item' and b['section_path']==['REFERENCES']}
    assert len(refs)==22
    assert 'Hybrid Model. arXiv preprint.' in refs['[7]']['text']
    assert 'https://www.kaggle.com/datasets/nikhileswarkomati/suicide-watch' in refs['[19]']['text']
    formulas=[b for b in data['blocks'] if b['kind']=='formula']
    assert sorted(b['source_equation_number'] for b in formulas)==list(range(1,8))
    assert all(b['equation_number_evidence']['method']=='ocr_right_margin_label' for b in formulas)


def test_native_punctuation_restoration_never_changes_letters_or_digits():
    data=json.loads((ROOT/'outputs/formulas-cached/camera-ready/quality.json').read_text())
    changes=[f for f in data['fixes'] if f['kind']=='native_visible_punctuation']
    letters=lambda text:''.join(c for c in compact(text) if c.isalnum())
    assert changes and all(letters(f['before'])==letters(f['after']) for f in changes)
    assert any('Safety-critical' in f['after'] and 'Safetycritical' in f['before'] for f in changes)


def test_upright_scan_keeps_the_previously_inverted_sentence():
    out=ROOT/'outputs/ocr-ordered/camera-ready-scan'
    doc=json.loads((out/'document.json').read_text())
    abstract=next(t['text'] for t in doc['texts'] if t['text'].startswith('Abstract'))
    assert 'robustness than transformer-based baselines for hidden suicidal' in abstract
    assert json.loads((out/'run.json').read_text())['ocr_line_rotation'] is False


def test_scan_table_numeric_values_match_the_reviewed_native_table():
    from decimal import Decimal
    def values(out):
        d=json.loads((out/'document.json').read_text())
        t=next(t for t in d['tables'] if t['data']['num_rows']==8 and t['data']['num_cols']==7)
        return {(c['start_row_offset_idx'],c['start_col_offset_idx']):Decimal(c['text']) for c in t['data']['table_cells'] if c['start_row_offset_idx']>0 and c['start_col_offset_idx']>0}
    expected=values(ROOT/'outputs/formulas-cached/camera-ready')
    actual=values(ROOT/'outputs/ocr-ordered/camera-ready-scan')
    assert len(actual)==42 and actual==expected


def test_scanned_math_paragraphs_have_source_pixel_fallbacks():
    import pymupdf as m
    out=ROOT/'outputs/ocr-ordered/camera-ready-scan';data=json.loads((out/'source-fragments.json').read_text())
    assert not data['warnings']
    selected=[b for b in data['blocks'] if b['ocr_text'].startswith(('The input token sequence','The output at time step','Feature Fusion:'))]
    assert len(selected)==3
    with m.open(ROOT/'inputs/camera-ready-scan.pdf') as pdf:
        for block in selected:
            assert not block['text_verified'] and (out/'paper.md').read_text().count(block['html'])==1
            for fragment in block['fragments']:
                expected=pdf[fragment['page']-1].get_pixmap(matrix=m.Matrix(3,3),clip=m.Rect(fragment['bbox']))
                actual=m.Pixmap(str(out/fragment['asset']))
                assert (actual.width,actual.height,actual.n)==(expected.width,expected.height,expected.n)
                # MuPDF image interpolation can round a small number of scanned
                # pixels by one 8-bit level between independent render passes.
                differences=[abs(a-b) for a,b in zip(actual.samples,expected.samples)]
                assert max(differences)<=1 and sum(differences)/len(differences)<.01
                assert hashlib.sha256((out/fragment['asset']).read_bytes()).hexdigest()==fragment['sha256']
