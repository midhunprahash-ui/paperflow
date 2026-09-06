"""Geometric OCR ordering and explicit marker repairs; no guessed text."""
from collections import Counter
import re
import unicodedata


def compact(text):return re.sub(r'\s+','',unicodedata.normalize('NFKC',text))


def repair_ocr_structure(doc,pdf,lines):
    from docling_core.types.doc import DocItemLabel,ListItem
    fixes=[]
    scanned={i+1 for i,p in enumerate(pdf) if not p.get_text().strip()}
    def box(item,index=0):
        p=item.prov[index];return p.bbox.to_top_left_origin(pdf[p.page_no-1].rect.height)
    def detach(item):
        if item.parent:
            parent=item.parent.resolve(doc);parent.children=[r for r in parent.children if r.cref!=item.self_ref]
        item.parent=None
    def absorb(target,item,kind):
        offset=len(target.text)+1;target.text+=' '+item.text;target.orig+=' '+item.orig
        for p in item.prov:
            p=p.model_copy(deep=True);p.charspan=(p.charspan[0]+offset,p.charspan[1]+offset);target.prov.append(p)
        detach(item);fixes.append(dict(kind=kind,id=target.self_ref,absorbed=item.self_ref))
    # OCR sometimes emits a zero-width axis-label duplicate inside a figure.
    for item,_ in list(doc.iterate_items()):
        if item.label!=DocItemLabel.TEXT or len(item.prov)!=1 or item.prov[0].page_no not in scanned:continue
        b=box(item)
        if b.r-b.l>.01 and b.b-b.t>.01:continue
        for asset in [*doc.tables,*doc.pictures]:
            if not asset.prov or asset.prov[0].page_no!=item.prov[0].page_no:continue
            a=box(asset)
            if a.l<=b.l<=a.r and a.t<=b.t<=a.b:
                detach(item);fixes.append(dict(kind='zero_area_ocr_duplicate_in_asset',id=item.self_ref,asset=asset.self_ref));break
    for item,_ in list(doc.iterate_items()):
        if item.label not in (DocItemLabel.TEXT,DocItemLabel.LIST_ITEM) or len(item.prov)!=1 or item.prov[0].page_no not in scanned:continue
        b=box(item);selected=[c for c in lines if c['page']==item.prov[0].page_no and b.l-1<=(c['bbox'][0]+c['bbox'][2])/2<=b.r+1 and b.t-1<=(c['bbox'][1]+c['bbox'][3])/2<=b.b+1]
        selected.sort(key=lambda c:(round(c['bbox'][1]/2)*2,c['bbox'][0]))
        text=' '.join(c['text'].strip() for c in selected)
        marker=getattr(item,'marker','')
        if marker and text.startswith(marker):text=text[len(marker):].lstrip()
        if text and Counter(compact(text))==Counter(compact(item.text)) and compact(text)!=compact(item.text):
            old=item.text;item.text=text
            fixes.append(dict(kind='ocr_lines_source_order',id=item.self_ref,before=old,after=text))
    # A detached bracketed reference marker belongs to the adjacent first line.
    leaves=[x for x,_ in doc.iterate_items()]
    for marker in leaves:
        if marker.label!=DocItemLabel.TEXT or not re.fullmatch(r'\[\d+\]',marker.text) or not marker.prov or marker.prov[0].page_no not in scanned:continue
        mb=box(marker)
        candidates=[x for x in leaves if x.label==DocItemLabel.LIST_ITEM and not x.marker and x.prov and x.prov[0].page_no==marker.prov[0].page_no
                    and abs(box(x).t-mb.t)<4 and 0<box(x).l-mb.r<30]
        if len(candidates)==1:
            target=candidates[0];target.marker=marker.text;target.enumerated=True
            detach(marker);fixes.append(dict(kind='detached_reference_marker',id=target.self_ref,marker=marker.text,absorbed=marker.self_ref))
    # Recover explicit letter/number markers embedded in OCR paragraph text.
    leaves=[x for x,_ in doc.iterate_items()]
    for i,item in enumerate(leaves):
        if item.label not in (DocItemLabel.TEXT,DocItemLabel.LIST_ITEM) or not item.prov or item.prov[0].page_no not in scanned:continue
        match=re.match(r'^([a-z]|\d+)([)])\s+(\S.*)$',item.text,re.S)
        if not match:continue
        mark=match[1]+match[2];number=int(match[1]) if match[1].isdigit() else ord(match[1])
        group=None;position=None
        if item.label==DocItemLabel.LIST_ITEM:group=item.parent.resolve(doc)
        else:
            for neighbor,delta in [(leaves[i-1] if i else None,-1),(leaves[i+1] if i+1<len(leaves) else None,1)]:
                if neighbor is None or neighbor.label!=DocItemLabel.LIST_ITEM:continue
                nm=re.fullmatch(r'([a-z]|\d+)\)',neighbor.marker)
                if not nm:continue
                value=int(nm[1]) if nm[1].isdigit() else ord(nm[1])
                if value==number+delta:
                    group=neighbor.parent.resolve(doc);position=next(k for k,r in enumerate(group.children) if r.cref==neighbor.self_ref)+(1 if delta==-1 else 0);break
        if group is None:continue
        data=item.model_dump();data.update(label=DocItemLabel.LIST_ITEM,text=match[3],marker=mark,enumerated=True,parent=group.get_ref())
        if item.label!=DocItemLabel.LIST_ITEM:
            detach(item);group.children.insert(position,item.get_ref())
        doc.texts[int(item.self_ref.split('/')[-1])]=ListItem.model_validate(data)
        fixes.append(dict(kind='ocr_explicit_list_marker',id=item.self_ref,marker=mark))
    # A continuation at the top of the second bibliography column belongs to the
    # preceding numbered reference, even when OCR put it outside the list group.
    leaves=[x for x,_ in doc.iterate_items()]
    refs={int(x.marker[1:-1]):x for x in leaves if x.label==DocItemLabel.LIST_ITEM and re.fullmatch(r'\[\d+\]',x.marker)}
    for item in leaves:
        if item.label!=DocItemLabel.TEXT or not item.prov or item.prov[0].page_no not in scanned or re.match(r'\[\d+\]|https?://',item.text):continue
        b=box(item);page=pdf[item.prov[0].page_no-1]
        for number,target in refs.items():
            nxt=refs.get(number+1)
            if not nxt or not target.prov or not nxt.prov or target.prov[-1].page_no!=item.prov[0].page_no or nxt.prov[0].page_no!=item.prov[0].page_no:continue
            a=box(target,-1);n=box(nxt)
            if a.r<page.rect.width/2<b.l and a.b>page.rect.height*.8 and b.t<page.rect.height*.2 and abs(b.l-n.l)<25 and -2<=n.t-b.b<5:
                absorb(target,item,'ocr_reference_column_continuation');break
    return fixes
