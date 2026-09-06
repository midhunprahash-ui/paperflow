import json
from pathlib import Path

import pytest

from evaluate import compare
from parse_pdf import inspect_pdf

def make_pdf(path, count):
    import pymupdf
    with pymupdf.open() as pdf:
        for i in range(count):
            pdf.new_page().insert_text((40,40),f"Source page {i+1}")
        pdf.save(path)

def test_page_limit_accepts_16_rejects_17(tmp_path):
    valid=tmp_path/"16.pdf";invalid=tmp_path/"17.pdf"
    make_pdf(valid,16);make_pdf(invalid,17)
    assert inspect_pdf(valid)["pages"]==16
    with pytest.raises(ValueError,match="17 pages"):
        inspect_pdf(invalid)

def test_encrypted_input_is_rejected(tmp_path):
    import pymupdf
    path=tmp_path/"locked.pdf"
    with pymupdf.open() as pdf:
        pdf.new_page()
        pdf.save(path,encryption=pymupdf.PDF_ENCRYPT_AES_256,user_pw="test-only",owner_pw="owner-test-only")
    with pytest.raises(ValueError,match="Encrypted"):
        inspect_pdf(path)

def test_evaluator_does_not_confuse_results_with_parent():
    expected={"pages":1,"headings":[[1,"Experiments and Results"],[2,"Results"]]}
    quality={"headings":[{"text":"V. Experiments and Results","level":1},{"text":"B. Results","level":2}]}
    assert compare(expected,quality,{"pages":1,"counts":{}})["failures"]==[]

def test_evaluator_catches_wrong_nesting_and_order():
    expected={"pages":1,"headings":[[1,"Introduction"],[2,"Method"]]}
    quality={"headings":[{"text":"Method","level":1},{"text":"Introduction","level":1}]}
    errors=compare(expected,quality,{"pages":1,"counts":{}})["failures"]
    assert {e["kind"] for e in errors}=={"heading_level","heading_order"}

def test_corpus_originals_unchanged():
    import hashlib
    root=Path(__file__).parent
    manifest=root/"inputs/sources.json"
    if not manifest.exists():pytest.skip("Run fetch_corpus.py first")
    for case in json.loads(manifest.read_text()):
        assert hashlib.sha256((root/"inputs"/case["file"]).read_bytes()).hexdigest()==case["sha256"]

def test_small_caps_repair_preserves_real_words():
    from normalize import repair_small_caps
    assert repair_small_caps("I. I NTRODUCTION")=="I. INTRODUCTION"
    assert repair_small_caps("A NEW METHOD")=="A NEW METHOD"

def test_export_keeps_nested_list_and_merged_cells():
    root=Path(__file__).parent
    output=root/"outputs/baseline/structure-fixture/paper.md"
    if not output.exists():pytest.skip("Run structure fixture first")
    text=output.read_text()
    assert "- First item\n    - Nested item" in text
    assert 'colspan="2"' in text
    assert "#### 1.1.1 Parameters" in text

def test_cross_column_paragraph_remains_in_results():
    root=Path(__file__).parent
    output=root/"outputs/baseline/camera-ready/paper.md"
    if not output.exists():pytest.skip("Run user paper first")
    text=output.read_text()
    assert text.index("## I. INTRODUCTION") < text.index("Because there are multiple") < text.index("capability to process vast")
    assert text.index("### B. Results") < text.index("The model obtained an F1-Score") < text.index("### C. Visual Analysis")
    assert "<!-- formula-not-decoded -->" not in text
    assert text.count("![Original equation,")==7

def test_reference_continuation_does_not_gain_a_number():
    root=Path(__file__).parent
    output=root/"outputs/baseline/camera-ready/paper.md"
    if not output.exists():pytest.skip("Run user paper first")
    text=output.read_text()
    assert "CNN-BiLSTM Hybrid Model. arXiv preprint." in text
    assert "\n8. Hybrid Model" not in text

def test_attention_title_is_not_a_subsection():
    root=Path(__file__).parent
    output=root/"outputs/baseline/attention/paper.md"
    if not output.exists():pytest.skip("Run Attention paper first")
    assert "\n# Attention Is All You Need\n" in output.read_text()

def test_single_column_body_is_not_sorted_as_author_columns():
    root=Path(__file__).parent
    output=root/"outputs/baseline/alexnet/paper.md"
    if not output.exists():pytest.skip("Run AlexNet first")
    text=output.read_text()
    assert text.index('Alex Krizhevsky') < text.index('Ilya Sutskever') < text.index('Geoffrey E. Hinton')
    assert text.index('## Abstract') < text.index('## 1 Introduction') < text.index('Despite the attractive qualities')
    assert 'hinton@cs.utoronto.ca Despite' not in text

def test_all_selected_structure_anchors():
    root=Path(__file__).parent
    expected=json.loads((root/'expectations.json').read_text())
    files=list((root/'outputs/baseline').glob('*/quality.json'))
    if not files:pytest.skip('Run corpus first')
    for path in files:
        name=path.parent.name.removesuffix('-scan').removesuffix('-mixed')
        run=json.loads((path.parent/'run.json').read_text())
        errors=compare(expected[name],json.loads(path.read_text()),run)['failures']
        assert not errors,(name,errors)

def test_user_table_values_remain_in_their_rows_and_columns():
    from decimal import Decimal
    root=Path(__file__).parent
    output=root/"outputs/baseline/camera-ready/raw.json"
    if not output.exists():pytest.skip("Run user paper first")
    # Transcribed against source page 5, Table I, not generated from extraction.
    expected=[
        ['0.9216','0.9216','0.9277','0.9256','20014.59','438'],
        ['0.9296','0.9297','0.9219','0.9277','7711.91','267.9'],
        ['0.9415','0.9414','0.9476','0.9453','3948.21','270.8'],
        ['0.9403','0.9404','0.9462','0.9446','3948.21','270.8'],
        ['0.9509','0.9509','0.9595','0.9523','5659.3','267.9'],
        ['0.9615','0.9615','0.9689','0.9641','5659.3','265.5'],
        ['0.9821','0.9812','0.9813','0.9812','6297.4','270.8'],
    ]
    tables=json.loads(output.read_text())['tables']
    table=next(t for t in tables if t['data']['num_rows']==8 and t['data']['num_cols']==7)
    cells={(c['start_row_offset_idx'],c['start_col_offset_idx']):c['text'] for c in table['data']['table_cells']}
    for row,values in enumerate(expected,1):
        for col,value in enumerate(values,1):assert Decimal(cells[row,col])==Decimal(value)

def read_user_structure():
    path=Path(__file__).parent/'outputs/formulas-cached/camera-ready/structure.json'
    if not path.exists():pytest.skip('Build the user paper review first')
    return json.loads(path.read_text())

def test_complete_source_inventory_and_section_ownership():
    from audit_structure import audit,read_gold
    result=audit(read_user_structure(),read_gold())
    assert result['expected_blocks']==137
    assert result['sections']==19
    assert result['failures']==[]

def test_inventory_rejects_missing_duplicate_and_misplaced_content():
    from copy import deepcopy
    from audit_structure import audit,read_gold
    original=read_user_structure()
    missing=deepcopy(original);missing['blocks'].pop()
    assert audit(missing,read_gold())['status']=='fail'
    duplicated=deepcopy(original);duplicated['blocks'].append(deepcopy(duplicated['blocks'][12]))
    assert audit(duplicated,read_gold())['status']=='fail'
    misplaced=deepcopy(original)
    block=next(b for b in misplaced['blocks'] if (b['text'] or '').startswith('The model obtained an F1-Score'))
    block['section_path']=['V. EXPERIMENTS AND RESULTS','C. Visual Analysis']
    assert any(f.get('details',{}).get('owner') for f in audit(misplaced,read_gold())['failures'])

def test_list_continuation_and_reference_url_stay_with_their_items():
    blocks=read_user_structure()['blocks']
    emotion=next(b for b in blocks if ' '.join((b['text'] or '').split()).startswith('Positive feelings'))
    assert emotion['kind']=='list_item' and 'well-being.' in emotion['text'] and 'anhedonia' in emotion['text']
    reference=next(b for b in blocks if b['marker']=='[19]')
    assert 'https://www.kaggle.com/datasets/nikhileswarkomati/suicide-watch' in reference['text']
    assert sum(b['section_path']==['REFERENCES'] and b['kind']=='list_item' for b in blocks)==22

def test_author_emails_and_orcids_are_separate_and_associated():
    blocks=read_user_structure()['blocks']
    by_id={b['id']:b for b in blocks}
    for email,prefix in [('midhuntech2023@gmail.com','Midhun'),('samvarghese936@gmail.com','Sam.')]:
        block=next(b for b in blocks if b['text']==email)
        assert by_id[block['metadata_group']]['text'].startswith(prefix)
    assert len([b for b in blocks if (b['text'] or '').startswith('ORCID')])==2

def test_section_graph_accounts_for_each_non_heading_block_once():
    structure=read_user_structure()
    sections={s['id']:s for s in structure['sections']}
    owned=[identifier for s in sections.values() for identifier in s['blocks']]
    assert len(owned)==len(set(owned))
    by_id={b['id']:b for b in structure['blocks']}
    for block in by_id.values():
        if block['section_id'] and block['kind']!='section_header':
            assert block['id'] in sections[block['section_id']]['blocks']
        if block['caption_of']:
            assert block['section_id']==by_id[block['caption_of']]['section_id']
    for section in sections.values():
        if section['parent']:
            parent=sections[section['parent']]
            assert parent['level']<section['level'] and section['id'] in parent['children']

def test_source_caption_placement_and_numbered_lists_in_markdown():
    path=Path(__file__).parent/'outputs/formulas-cached/camera-ready/paper.md'
    if not path.exists():pytest.skip('Build the user paper review first')
    text=path.read_text()
    assert text.index('![Image]') < text.index('Fig. 2. Model')
    assert text.index('TABLE I.') < text.index('| Model ')
    assert '\n1) Performance Metrics' in text
    assert '\n**The final curated dataset includes five groups :-**' in text

def test_new_papers_preserve_terminal_sections_without_rewriting_spelling():
    root=Path(__file__).parent
    for name,spelling in [('mobilenet-v2','Acknowledgments'),('unet','Acknowlegements')]:
        path=root/'outputs/heldout-structure'/name/'structure.json'
        if not path.exists():pytest.skip('Run the two additional papers first')
        data=json.loads(path.read_text())
        section=next(s for s in data['sections'] if s['title']==spelling)
        assert section['level']==1 and section['parent'] is None
        owned=[b for b in data['blocks'] if b['id'] in section['blocks']]
        assert any(b['kind']=='text' and b['text'] for b in owned)
