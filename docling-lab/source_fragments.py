"""Keep scanned paragraph appearance when native inline evidence is unavailable."""
from __future__ import annotations
import hashlib
import html
import json
import re


def preserve_scanned_paragraphs(doc,pdf,out,md):
    import pymupdf as m
    from docling_core.transforms.serializer.markdown import MarkdownDocSerializer
    serializer=MarkdownDocSerializer(doc=doc)
    scanned={i+1 for i,p in enumerate(pdf) if not p.get_text().strip() and p.get_images()}
    blocks=[];warnings=[]
    for item,_ in doc.iterate_items():
        if item.label.value!='text' or not item.prov or item.children or not any(p.page_no in scanned for p in item.prov):continue
        original=serializer.serialize(item=item).text
        pattern=re.compile(r'(?<![^\n])'+re.escape(original)+r'(?=\n\n|\Z)')
        if len(list(pattern.finditer(md)))!=1:
            warnings.append(dict(id=item.self_ref,reason='source_fragment_export_not_unique'));continue
        fragments=[]
        for n,prov in enumerate(item.prov):
            page=pdf[prov.page_no-1];b=prov.bbox.to_top_left_origin(page.rect.height)
            rect=(m.Rect(b.l,b.t,b.r,b.b)+(-1.5,-3,1.5,2))&page.rect
            if rect.is_empty or rect.width<1 or rect.height<1:
                warnings.append(dict(id=item.self_ref,reason='source_fragment_invalid_bounds'));break
            asset='assets/source-'+item.self_ref.replace('#/','').replace('/','-')+f'-{n}.png'
            page.get_pixmap(matrix=m.Matrix(3,3),clip=rect).save(out/asset)
            fragments.append(dict(page=prov.page_no,bbox=list(rect),asset=asset,
                                  sha256=hashlib.sha256((out/asset).read_bytes()).hexdigest()))
        else:
            images=' '.join(f'<img class="source-paragraph" src="{f["asset"]}" alt="Original paragraph, page {f["page"]}" style="width:{(f["bbox"][2]-f["bbox"][0])/10:.3f}em;max-width:100%;height:auto">' for f in fragments)
            rendered='<span data-source-block="'+html.escape(item.self_ref,quote=True)+'">'+images+'</span>'
            md=pattern.sub(lambda _:rendered,md,count=1)
            blocks.append(dict(id=item.self_ref,fragments=fragments,html=rendered,ocr_text=item.text,
                               text_verified=False,reason='scanned_inline_formatting_unverified'))
    result=dict(schema_version=1,blocks=blocks,warnings=warnings,
                limits='Original paragraph images preserve scanned typography and inline math. OCR text remains structured but unverified. This is a visual fallback, not corrected or accessible semantic OCR. Lists, headings and inferred relationships still need source validation.')
    (out/'source-fragments.json').write_text(json.dumps(result,indent=2,ensure_ascii=False))
    return md,result
