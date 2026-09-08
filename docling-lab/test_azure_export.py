import copy
import hashlib
import pymupdf
import pytest
from azure_export import export_azure

@pytest.fixture
def fixture(tmp_path):
    source=tmp_path/'source.pdf'
    pdf=pymupdf.open();page=pdf.new_page();page.insert_text((50,60),'A scientific document with math x = 1.');pdf.save(source);pdf.close()
    region={'pageNumber':1,'polygon':[40,40,400,40,400,90,40,90]}
    result={'status':'succeeded','analyzeResult':{'modelId':'prebuilt-layout','pages':[{'pageNumber':1,'width':595,'height':842,'formulas':[{'value':'WRONG_MODEL_TEXT','kind':'inline','polygon':[200,45,240,45,240,65,200,65],'span':{'offset':12,'length':3}}]}],
        'paragraphs':[{'content':'An equation :formula: remains.','spans':[{'offset':0,'length':40}],'boundingRegions':[region]}]}}
    return source,result,tmp_path/'out',region

def test_math_is_source_image_not_unverified_latex(fixture):
    source,r,out,_=fixture;p=export_azure(source,r,out);node=p['sections'][0]
    assert [part['type'] for part in node['inline']]==['text','image','text']
    assert node['inline'][1]['alt']=='Original equation'
    assert 'WRONG_MODEL_TEXT' not in str(node['inline'])
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
