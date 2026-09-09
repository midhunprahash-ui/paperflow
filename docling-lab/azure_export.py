"""Normalize Azure Layout into Rpaper v2 with LaTeX candidates and source fallbacks."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import pymupdf
from azure_presentation import NativeEmphasis, heading_level, known_heading


def export_azure(source, response, output):
    result = response.get('analyzeResult', {})
    if response.get('status') != 'succeeded' or result.get('modelId') != 'prebuilt-layout':
        raise ValueError('Azure did not return a completed layout result')
    pdf = pymupdf.open(source)
    pages = {p['pageNumber']: p for p in result.get('pages', [])}
    if set(pages) != set(range(1, len(pdf)+1)) or not 1 <= len(pdf) <= 16:
        raise ValueError('Azure output page coverage does not match the PDF')
    output.mkdir(parents=True, exist_ok=True)
    emphasis = NativeEmphasis(pdf, pages)
    assets = {}; nodes = []; counter = 0
    def spans(item):
        return [(s['offset'], s['offset']+s['length']) for s in item.get('spans', [])]
    def offset(item):
        return min((a for a,b in spans(item)), default=10**12)
    def regions(item):
        return item.get('boundingRegions', [])
    def crop(region):
        nonlocal counter
        number = region['pageNumber']; page = pdf[number-1]; info = pages[number]
        polygon = region['polygon']
        if len(polygon)<8 or len(polygon)%2 or not all(isinstance(x,(int,float)) and math.isfinite(x) for x in polygon):
            raise ValueError('Invalid Azure geometry')
        if info['width']<=0 or info['height']<=0: raise ValueError('Invalid Azure page dimensions')
        xs = [x*page.rect.width/info['width'] for x in polygon[::2]]
        ys = [y*page.rect.height/info['height'] for y in polygon[1::2]]
        rect = pymupdf.Rect(min(xs),min(ys),max(xs),max(ys))
        rect = (rect + (-1,-1,1,1)) & page.rect
        if rect.is_empty: raise ValueError('Azure crop is outside the page')
        counter += 1
        if counter>4096: raise ValueError('Too many extracted assets')
        name = f'assets/source-{counter:04}.png'; path=output/name; path.parent.mkdir(exist_ok=True)
        page.get_pixmap(matrix=pymupdf.Matrix(2,2),clip=rect,alpha=False).save(path)
        assets[name] = dict(path=name,sha256=hashlib.sha256(path.read_bytes()).hexdigest(),mediaType='image/png')
        return name, max(.4,rect.width/11)
    def base(item, identifier):
        rs=regions(item)
        return dict(id=identifier,order=0,sourceId=identifier,page=rs[0]['pageNumber'] if rs else None,provenance=rs)
    formulas=[]
    for page in pages.values():
        for f in page.get('formulas',[]):
            formulas.append({**f,'pageNumber':page['pageNumber']})
    def item_formulas(item):
        return sorted([f for f in formulas if any(a<=f['span']['offset']<b for a,b in spans(item))],key=lambda f:f['span']['offset'])
    def readable(item):
        text=item.get('content',''); fs=iter(item_formulas(item))
        return re.sub(':formula:',lambda _:next(fs,{}).get('value','[equation in original PDF]'),text)
    def inline(item):
        text=item.get('content',''); fs=item_formulas(item)
        if text.count(':formula:') != len(fs): return None
        parts=[]
        for i,t in enumerate(text.split(':formula:')):
            if t: parts.append(dict(type='text',text=t))
            if i<len(fs):
                f=fs[i]; asset,width=crop(dict(pageNumber=f['pageNumber'],polygon=f['polygon']))
                parts.append(dict(type='image',asset=asset,alt='Original equation',widthEm=width,candidateLatex=f.get('value','')))
        return parts
    occupied=[]; excluded=set()
    for kind,collection in [('table',result.get('tables',[])),('figure',result.get('figures',[]))]:
        for i,item in enumerate(collection):
            if not regions(item): raise ValueError('Structured block has no source geometry')
            identifier=f'azure-{kind}-{i}'; n=base(item,identifier)
            occupied.extend(spans(item)); excluded.update(item.get('elements',[]))
            caption=item.get('caption')
            if caption: excluded.update(caption.get('elements',[]))
            if kind=='figure':
                # Source crops avoid trusting provider download URLs; support multi-page figures.
                for j,region in enumerate(regions(item)):
                    asset,_=crop(region)
                    nodes.append((offset(item)+j*.01,dict(**{**n,'id':identifier+f'-{j}','page':region['pageNumber']},type='figure',alt=readable(caption) if caption else 'Original figure',assetUrl=asset,sourceAsset=asset)))
                if caption:
                    nodes.append((offset(caption),dict(**base(caption,identifier+'-caption'),type='caption',text=readable(caption),captionOf=identifier)))
            else:
                rows=item['rowCount']; cols=item['columnCount']
                if not 1<=rows<=1000 or not 1<=cols<=100: raise ValueError('Invalid table dimensions')
                cells=[]; grid=[['']*cols for _ in range(rows)]; covered=set()
                for c in item.get('cells',[]):
                    row=c['rowIndex']; col=c['columnIndex']; rs=c.get('rowSpan',1); cs=c.get('columnSpan',1)
                    if min(row,col)<0 or min(rs,cs)<1 or row+rs>rows or col+cs>cols: raise ValueError('Invalid table cell')
                    slots={(r,k) for r in range(row,row+rs) for k in range(col,col+cs)}
                    if slots & covered: raise ValueError('Overlapping table cells')
                    covered.update(slots); text=readable(c); grid[row][col]=text
                    cell=dict(row=row,col=col,rowSpan=rs,colSpan=cs,header=c.get('kind')=='columnHeader',text=text)
                    if ':formula:' in c.get('content',''):
                        if len(regions(c))!=1: raise ValueError('Math cell lacks an unambiguous source crop')
                        cell['sourceAsset']=crop(regions(c)[0])[0]
                        parts=inline(c)
                        if parts is not None:cell['inline']=parts
                    cells.append(cell)
                nodes.append((offset(item),dict(**n,type='table',rowCount=rows,colCount=cols,headers=[],rows=grid,cells=cells,caption=readable(caption) if caption else None)))
    title=source.stem
    for i,p in enumerate(result.get('paragraphs',[])):
        if f'/paragraphs/{i}' in excluded: continue
        if spans(p) and all(any(a<=x and y<=b for a,b in occupied) for x,y in spans(p)): continue
        role=p.get('role','paragraph')
        if role in ('pageHeader','pageFooter','pageNumber'): continue
        identifier=f'azure-paragraph-{i}'; n=base(p,identifier); text=readable(p)
        if p.get('content','').strip()==':formula:' and len(item_formulas(p))==1 and regions(p):
            # A provider formula label is a prediction, not structural truth.
            # Native text recovers small-caps headings that formula OCR mangles.
            native_heading=known_heading(emphasis.text(p))
            heading=native_heading or known_heading(text)
            if heading:
                n.update(type='heading',text=heading,level=1,explicitHierarchy=False,
                    classificationEvidence=dict(originalRole=role,candidateLatex=text,sourceAsset=crop(regions(p)[0])[0],method='native-pdf-heading' if native_heading else 'heading-vocabulary'))
                nodes.append((offset(p),n));continue
        # Azure often stores display equations and their numbers as paragraphs,
        # including two equations followed by two labels in the same block.
        # Promote only formula-only blocks with an unambiguous label count.
        content=p.get('content',''); fs=item_formulas(p)
        labels=re.findall(r'\(\s*\d+[a-z]?\s*\)',content)
        remainder=re.sub(r':formula:|\(\s*\d+[a-z]?\s*\)|\s+','',content)
        if role in ('paragraph','formulaBlock') and fs and all(f.get('kind')=='display' for f in fs) and not remainder and content.count(':formula:')==len(fs) and len(labels) in (0,len(fs)):
            for j,f in enumerate(fs):
                region=dict(pageNumber=f['pageNumber'],polygon=f['polygon'])
                equation={**n,'id':identifier if j==0 else f'{identifier}-equation-{j+1}'}
                equation.update(type='formula',latex='',candidateLatex=f.get('value',''),verified=False,sourceAsset=crop(region)[0],page=f['pageNumber'])
                if labels:equation['label']=labels[j]
                nodes.append((offset(p)+j*.001,equation))
            continue
        if role=='title':
            if title==source.stem:title=text
            n.update(type='heading',level=1,text=text,role='title')
        elif role=='sectionHeading':
            n.update(type='heading',level=1,text=text,explicitHierarchy=False)
        elif p.get('content','').strip()==':formula:' and regions(p):
            n.update(type='formula',latex='',candidateLatex=text,verified=False,sourceAsset=crop(regions(p)[0])[0])
        else:
            n.update(type='paragraph',text=text)
            if ':formula:' in p.get('content',''):
                parts=inline(p)
                if parts is not None:n['inline']=parts
                else:
                    if not regions(p):raise ValueError('Math paragraph has no source geometry')
                    n['sourceFragments']=[dict(asset=(v:=crop(r))[0],page=r['pageNumber'],widthEm=v[1]) for r in regions(p)]
            else:
                parts=emphasis.inline(p)
                if parts is not None:n['inline']=parts
        nodes.append((offset(p),n))
    ordered=[n for _,n in sorted(nodes,key=lambda pair:pair[0])]
    if not ordered:raise ValueError('Azure returned no readable blocks')
    hierarchy=[]; stack=[]; inside_lettered_section=False
    for order,n in enumerate(ordered):
        n['order']=order
        if n['type']=='heading' and n.get('role')!='title':
            n['level'],inside_lettered_section=heading_level(n['text'],inside_lettered_section)
            while stack and stack[-1]['level']>=n['level']:stack.pop()
            h=dict(id=n['id'],title=n['text'],level=n['level'],parent=stack[-1]['id'] if stack else None,children=[],blocks=[])
            if stack:stack[-1]['children'].append(h['id'])
            hierarchy.append(h);stack.append(h)
        n['sectionId']=stack[-1]['id'] if stack else None;n['sectionPath']=[h['id'] for h in stack]
        if stack:stack[-1]['blocks'].append(n['id'])
    paper=dict(schemaVersion=2,metadata=dict(title=title,authors=[],pageCount=len(pdf)),sections=ordered,references=[],assets=assets,hierarchy=hierarchy,
        parser=dict(name='azure-document-intelligence',version=result.get('apiVersion','2024-11-30'),reviewRequired=True,limits='Layout, text and LaTeX are machine-extracted and unverified. Supported LaTeX is typeset with original equation crops retained for comparison and fallback; table text and inferred headings remain unverified.'),
        source=dict(type='pdf',filename=source.name,checksum=hashlib.sha256(source.read_bytes()).hexdigest()))
    (output/'app-manifest.json').write_text(json.dumps(paper,ensure_ascii=False))
    (output/'quality.json').write_text(json.dumps(dict(parser=paper['parser'],page_count=len(pdf),block_count=len(ordered),asset_count=len(assets))))
    pdf.close();return paper

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('pdf',type=Path);p.add_argument('response',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
    export_azure(a.pdf,json.loads(a.response.read_text()),a.output)
