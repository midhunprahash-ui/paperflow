import copy
import hashlib
import pymupdf
import pytest
from azure_export import export_azure
from azure_presentation import NativeEmphasis, heading_level, known_heading


@pytest.mark.parametrize('text,expected',[
    ('VIII. A CKNOWLEDGEMENT','VIII. Acknowledgement'),
    (r'\mathrm{References}','References'),
    (r'\text{Results}=x^2',None),
    (r'\frac{\text{Methods}}{n}',None),
    (r'\mathrm{References}_{i}',None),
    (r'\mathrm{VIII}.\mathrm{Acknomiedement}',None),
])
def test_heading_vocabulary_never_strips_math_operators(text,expected):
    assert known_heading(text)==expected


def test_native_pdf_overrides_misclassified_azure_heading_and_repairs_hierarchy(fixture):
    source,r,out,region=fixture
    pdf=pymupdf.open();page=pdf.new_page();page.insert_text((50,60),'VIII. ACKNOWLEDGEMENT');pdf.save(source);pdf.close()
    r['analyzeResult']['pages'][0]['formulas'][0].update(kind='display',value=r'\mathrm{VIII}.\mathrm{Acknomiedement}')
    r['analyzeResult']['paragraphs']=[
        {'content':':formula:','role':'formulaBlock','spans':[{'offset':12,'length':9}],'boundingRegions':[region]},
        {'content':'We thank our colleagues.','spans':[{'offset':30,'length':24}],'boundingRegions':[region]},
    ]
    paper=export_azure(source,r,out);heading=paper['sections'][0]
    assert heading['type']=='heading' and heading['text']=='VIII. Acknowledgement'
    assert heading['id']=='azure-paragraph-0' and heading['provenance']==[region]
    assert 'sourceAsset' not in heading
    assert heading['classificationEvidence']['method']=='native-pdf-heading'
    assert (out/heading['classificationEvidence']['sourceAsset']).is_file()
    assert paper['sections'][1]['sectionId']==heading['id']
    assert paper['hierarchy'][0]['title']=='VIII. Acknowledgement'


def test_native_emphasis_preserves_azure_text_and_rejects_mismatches(tmp_path):
    pdf = pymupdf.open()
    page = pdf.new_page()
    page.insert_text((50, 60), 'Bold', fontname='hebo')
    page.insert_text((90, 60), 'italic', fontname='heit')
    page.insert_text((125, 60), 'plain', fontname='helv')
    item = {'content': 'Bold italic plain', 'boundingRegions': [
        {'pageNumber': 1, 'polygon': [40, 40, 170, 40, 170, 70, 40, 70]}]}
    recover = NativeEmphasis(pdf, {1: {'width': page.rect.width, 'height': page.rect.height}})
    parts = recover.inline(item)
    assert ''.join(p['text'] for p in parts) == item['content']
    assert any(p['bold'] and 'Bold' in p['text'] for p in parts)
    assert any(p['italic'] and 'italic' in p['text'] for p in parts)
    assert not parts[-1]['bold'] and not parts[-1]['italic']
    assert recover.inline({**item, 'content': 'Bold changed plain'}) is None
    assert recover.inline({**item, 'content': 'Bold :formula: plain'}) is None
    assert recover.inline({**item, 'boundingRegions': []}) is None
    pdf.close()


def test_azure_heading_depth_distinguishes_lettered_and_roman_sections():
    assert heading_level('III. METHODS', False) == (1, False)
    assert heading_level('C. Visual Analysis', False) == (2, True)
    assert heading_level('1) Linguistic markers:', True) == (3, True)
    assert heading_level('VI. CONCLUSION', True) == (1, False)
    assert heading_level('2.3.4 Results', False) == (3, False)

@pytest.fixture
def fixture(tmp_path):
    source=tmp_path/'source.pdf'
    pdf=pymupdf.open();page=pdf.new_page();page.insert_text((50,60),'A scientific document with math x = 1.');pdf.save(source);pdf.close()
    region={'pageNumber':1,'polygon':[40,40,400,40,400,90,40,90]}
    result={'status':'succeeded','analyzeResult':{'modelId':'prebuilt-layout','pages':[{'pageNumber':1,'width':595,'height':842,'formulas':[{'value':'WRONG_MODEL_TEXT','kind':'inline','polygon':[200,45,240,45,240,65,200,65],'span':{'offset':12,'length':3}}]}],
        'paragraphs':[{'content':'An equation :formula: remains.','spans':[{'offset':0,'length':40}],'boundingRegions':[region]}]}}
    return source,result,tmp_path/'out',region

def test_math_keeps_latex_candidate_and_original_image(fixture):
    source,r,out,_=fixture;p=export_azure(source,r,out);node=p['sections'][0]
    assert [part['type'] for part in node['inline']]==['text','image','text']
    assert node['inline'][1]['alt']=='Original equation'
    assert node['inline'][1]['candidateLatex']=='WRONG_MODEL_TEXT'
    assert 'verified' not in node['inline'][1]
    for asset in p['assets'].values():assert hashlib.sha256((out/asset['path']).read_bytes()).hexdigest()==asset['sha256']

def test_ambiguous_placeholder_mapping_preserves_paragraph_crop(fixture):
    source,r,out,_=fixture;r['analyzeResult']['pages'][0]['formulas']=[]
    p=export_azure(source,r,out);assert p['sections'][0]['sourceFragments'];assert 'inline' not in p['sections'][0]

def test_missing_page_fails_before_publication(fixture):
    source,r,out,_=fixture;r['analyzeResult']['pages']=[]
    with pytest.raises(ValueError,match='coverage'):export_azure(source,r,out)

def test_overlapping_table_cells_rejected(fixture):
    source,r,out,region=fixture
    c={'rowIndex':0,'columnIndex':0,'content':'x'}
    r['analyzeResult']['tables']=[{'rowCount':1,'columnCount':1,'cells':[c,copy.deepcopy(c)],'boundingRegions':[region]}]
    with pytest.raises(ValueError,match='Overlapping'):export_azure(source,r,out)

def test_table_math_uses_source_and_suppresses_duplicate_paragraph(fixture):
    source,r,out,region=fixture
    r['analyzeResult']['tables']=[{'rowCount':1,'columnCount':1,'spans':[{'offset':0,'length':40}], 'cells':[{'rowIndex':0,'columnIndex':0,'content':':formula:','spans':[{'offset':12,'length':3}],'boundingRegions':[region]}],'boundingRegions':[region]}]
    p=export_azure(source,r,out);assert len(p['sections'])==1;assert p['sections'][0]['cells'][0]['sourceAsset'] in p['assets']
    part=p['sections'][0]['cells'][0]['inline'][0]
    assert part['candidateLatex']=='WRONG_MODEL_TEXT'
    assert part['asset'] in p['assets']

def test_display_math_retains_unverified_candidate_and_source(fixture):
    source,r,out,region=fixture
    r['analyzeResult']['paragraphs']=[{'content':':formula:','spans':[{'offset':12,'length':9}],'boundingRegions':[region]}]
    node=export_azure(source,r,out)['sections'][0]
    assert node['type']=='formula' and node['verified'] is False
    assert node['latex']=='' and node['candidateLatex']=='WRONG_MODEL_TEXT'
    assert (out/node['sourceAsset']).is_file()

@pytest.mark.parametrize('role',['paragraph','formulaBlock'])
def test_numbered_display_equations_become_blocks_with_original_labels(fixture,role):
    source,r,out,region=fixture
    formula=r['analyzeResult']['pages'][0]['formulas'][0]
    formula.update(kind='display',value='x^2')
    second=copy.deepcopy(formula);second.update(value='y^2',span={'offset':22,'length':9})
    r['analyzeResult']['pages'][0]['formulas'].append(second)
    r['analyzeResult']['paragraphs']=[{'role':role,'content':':formula: :formula: (2) (3)','spans':[{'offset':12,'length':30}],'boundingRegions':[region]}]
    nodes=export_azure(source,r,out)['sections']
    assert [n['type'] for n in nodes]==['formula','formula']
    assert [n['label'] for n in nodes]==['(2)','(3)']
    assert [n['candidateLatex'] for n in nodes]==['x^2','y^2']
    assert nodes[0]['id']=='azure-paragraph-0'
    assert nodes[1]['id']!=nodes[0]['id']
    assert all(n['sourceId']=='azure-paragraph-0' and n['verified'] is False for n in nodes)

def test_ambiguous_display_label_count_stays_with_its_paragraph(fixture):
    source,r,out,region=fixture
    r['analyzeResult']['pages'][0]['formulas'][0]['kind']='display'
    r['analyzeResult']['paragraphs']=[{'content':':formula: (2) (3)','spans':[{'offset':12,'length':30}],'boundingRegions':[region]}]
    node=export_azure(source,r,out)['sections'][0]
    assert node['type']=='paragraph' and node['text'].endswith('(2) (3)')

def test_ambiguous_table_math_retains_entire_cell_image(fixture):
    source,r,out,region=fixture
    r['analyzeResult']['tables']=[{'rowCount':1,'columnCount':1,'spans':[{'offset':0,'length':40}], 'cells':[{'rowIndex':0,'columnIndex':0,'content':':formula: and :formula:','spans':[{'offset':0,'length':40}],'boundingRegions':[region]}],'boundingRegions':[region]}]
    cell=export_azure(source,r,out)['sections'][0]['cells'][0]
    assert 'inline' not in cell
    assert (out/cell['sourceAsset']).is_file()
