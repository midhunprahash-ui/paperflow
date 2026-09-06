"""Map reviewed lab artifacts into the app's typed v2 manifest, never raw HTML."""
from __future__ import annotations
import argparse
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re


def identifier(value):
    return 'docling-'+value.removeprefix('#/').replace('/', '-') if value else None


class InlineParser(HTMLParser):
    def __init__(self, asset):
        super().__init__(convert_charrefs=True)
        self.parts=[];self.tags=[];self.asset=asset
    def handle_starttag(self, tag, attrs):
        attrs=dict(attrs)
        if tag in ('strong','em','sub','sup'):self.tags.append(tag)
        elif tag=='img':
            style=attrs.get('style','')
            width=re.search(r'(?:^|;)width:([\d.]+)em',style)
            descent=re.search(r'vertical-align:-([\d.]+)em',style)
            self.parts.append(dict(type='image',asset=self.asset(attrs['src']),alt=attrs.get('alt','Original expression'),
                                   widthEm=float(width[1]) if width else None,descentEm=float(descent[1]) if descent else 0))
        elif tag!='span':raise ValueError('Unsupported inline tag')
    def handle_endtag(self,tag):
        if tag in self.tags:self.tags.remove(tag)
    def handle_data(self,data):
        if data:self.parts.append(dict(type='text',text=data,bold='strong' in self.tags,italic='em' in self.tags,
                                       script='sub' if 'sub' in self.tags else 'sup' if 'sup' in self.tags else None))


def export_app(out: Path):
    import pymupdf as m
    from docling_core.types.doc import DoclingDocument
    out=out.resolve();run=json.loads((out/'run.json').read_text())
    if run['state']!='converted' or run.get('conversion_issues') or not 1<=run['pages']<=16:
        raise ValueError('Only complete 1–16 page conversions can enter the reader')
    graph=json.loads((out/'structure.json').read_text())
    doc=DoclingDocument.load_from_json(out/'document.json')
    items={x.self_ref:x for x,_ in doc.iterate_items()}
    inline={b['id']:b for b in json.loads((out/'inline-content.json').read_text())['blocks']}
    fragments={b['id']:b for b in json.loads((out/'source-fragments.json').read_text())['blocks']}
    tables=json.loads((out/'table-content.json').read_text())
    formulas={b['id']:b for b in json.loads((out/'formula-candidates.json').read_text())}
    assets={}
    def asset(relative):
        path=(out/relative).resolve(strict=True)
        if not path.is_relative_to(out) or path.suffix.lower()!='.png':raise ValueError('Invalid parser asset path')
        key=path.relative_to(out).as_posix()
        assets[key]=dict(path=key,sha256=hashlib.sha256(path.read_bytes()).hexdigest(),mediaType='image/png')
        return key
    nodes=[]
    with m.open(run['input']) as pdf:
        for order,b in enumerate(graph['blocks']):
            item=items[b['id']];prov=b['provenance'];kind=b['kind'];text=b.get('text') or ''
            node=dict(id=identifier(b['id']),sourceId=b['id'],order=order,sectionId=identifier(b['section_id']),
                      sectionPath=b['section_path'],provenance=prov,role=kind)
            if prov:
                p=item.prov[0];page=pdf[p.page_no-1];bounds=p.bbox.to_top_left_origin(page.rect.height)
                node.update(page=p.page_no,bounds=[bounds.l,bounds.t,bounds.r,bounds.b])
            if kind=='section_header':node.update(type='heading',level=item.level,text=text,explicitHierarchy=True)
            elif kind=='list_item':node.update(type='list_item',text=text,marker=b['marker'] or '•',listId=identifier(b['list_id']))
            elif kind=='caption':node.update(type='caption',text=text,captionOf=identifier(b['caption_of']))
            elif kind=='formula':
                f=formulas.get(b['id'])
                if not f:raise ValueError('Formula missing source fallback')
                node.update(type='formula',latex='',candidateLatex=f['latex'],sourceAsset=asset(f['source_image']),verified=False)
            elif kind=='figure':
                name='assets/app-'+identifier(b['id'])+'.png'
                if not prov:raise ValueError('Figure missing source location')
                page.get_pixmap(matrix=m.Matrix(2,2),clip=m.Rect(node['bounds'])).save(out/name)
                node.update(type='figure',assetUrl='',sourceAsset=asset(name),alt='Original figure')
            elif kind=='table':
                repair=tables['repairs'].get(b['id'],{});images={c['index']:c['source_image'] for c in repair.get('cells',[])}
                cells=[]
                for i,c in enumerate(item.data.table_cells):
                    cell=dict(row=c.start_row_offset_idx,col=c.start_col_offset_idx,rowSpan=c.row_span,colSpan=c.col_span,
                              header=c.column_header,text=c.text)
                    if i in images:cell['sourceAsset']=asset(images[i])
                    cells.append(cell)
                node.update(type='table',headers=[],rows=[],rowCount=item.data.num_rows,colCount=item.data.num_cols,cells=cells)
            elif kind=='code':node.update(type='code',code=text)
            else:node.update(type='paragraph',text=text)
            if kind=='text' and b['id'] in fragments:
                node['sourceFragments']=[dict(asset=asset(f['asset']),page=f['page'],widthEm=(f['bbox'][2]-f['bbox'][0])/10) for f in fragments[b['id']]['fragments']]
            elif kind=='text' and b['id'] in inline:
                parser=InlineParser(asset);parser.feed(inline[b['id']]['html']);node['inline']=parser.parts
            nodes.append(node)
    markdown=(out/'paper.md').read_text()
    for relative in re.findall(r'!\[[^\]]*\]\(([^)]+)\)',markdown)+re.findall(r'<img\b[^>]*\bsrc="([^"]+)"',markdown):
        asset(relative)
    title=next((b['text'] for b in graph['blocks'] if b['kind']=='title'),doc.name)
    manifest=dict(schemaVersion=2,metadata=dict(title=title,authors=[],pageCount=run['pages']),sections=nodes,references=[],
                  hierarchy=[{**s,'id':identifier(s['id']),'parent':identifier(s['parent']),
                              'children':[identifier(i) for i in s['children']], 'blocks':[identifier(i) for i in s['blocks']]} for s in graph['sections']],
                  assets=assets,source=dict(type='pdf',filename=Path(run.get('uploaded_input',run['input'])).name,checksum=run['sha256']),
                  parser=dict(name='docling',version=run['docling'],reviewRequired=True,
                              limits='Source-backed math and scanned paragraphs preserve appearance; semantic transcription remains unverified.'))
    if len(nodes)!=len(graph['blocks']) or len({b['id'] for b in nodes})!=len(nodes):raise ValueError('Block inventory mismatch')
    (out/'app-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    return manifest


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('output',type=Path);args=p.parse_args()
    result=export_app(args.output)
    print(json.dumps({'blocks':len(result['sections']),'assets':len(result['assets'])}))
