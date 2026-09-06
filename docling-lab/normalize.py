"""Conservative, logged repairs using source geometry and explicit heading markers."""
from __future__ import annotations
import re

SMALL_CAPS={"INTRODUCTION","RELATED","WORKS","LIMITATIONS","DEPLOYMENT","ACKNOWLEDGEMENT","ACKNOWLEDGMENTS","ACKNOWLEDGEMENTS","REFERENCES","CONCLUSION","METHODOLOGY","RESULTS","EXPERIMENTS"}

def repair_small_caps(text):
    return re.sub(r"\b([A-Z])\s+([A-Z]{2,})\b",lambda m:m[1]+m[2] if m[1]+m[2] in SMALL_CAPS else m[0],text)

def normalize_document(doc, pdf):
    import pymupdf
    from docling_core.types.doc import SectionHeaderItem, TitleItem, DocItemLabel
    fixes=[];warnings=[]

    # Layout sometimes splits the first equation symbol into a tiny text block.
    # Reunite touching blocks on the same source line for a complete equation crop.
    ordered_items=[x for x,_ in doc.iterate_items()]
    for previous,item in zip(ordered_items,ordered_items[1:]):
        if previous.label!=DocItemLabel.TEXT or item.label!=DocItemLabel.FORMULA:continue
        if not re.fullmatch(r'[A-Za-z]',previous.text.strip()) or not previous.prov or not item.prov:continue
        pp,ip=previous.prov[0],item.prov[0]
        if pp.page_no!=ip.page_no:continue
        height=pdf[ip.page_no-1].rect.height
        pb=pp.bbox.to_top_left_origin(height);ib=ip.bbox.to_top_left_origin(height)
        if abs(pb.r-ib.l)>12 or min(pb.b,ib.b)<=max(pb.t,ib.t):continue
        ib.l=min(pb.l,ib.l);ib.t=min(pb.t,ib.t);ib.r=max(pb.r,ib.r);ib.b=max(pb.b,ib.b)
        ip.bbox=ib.to_bottom_left_origin(height)
        parent=previous.parent.resolve(doc)
        parent.children=[r for r in parent.children if r.cref!=previous.self_ref]
        fixes.append({'kind':'equation_symbol_reunited','id':item.self_ref,'absorbed':previous.self_ref})

    # A list item with an explicit letter marker and the same visual styling as
    # other lettered section headings can be a misclassified section header.
    letter_headings=[x for x in doc.texts if x.label==DocItemLabel.SECTION_HEADER and re.match(r"^[A-Z]\.\s",x.text)]
    for i,item in enumerate(doc.texts):
        if item.label!=DocItemLabel.LIST_ITEM or not letter_headings or not item.prov:continue
        marker=getattr(item,"marker","")
        if not re.fullmatch(r"[A-Z]\.",marker.strip()):continue
        if len(item.text)>160 or len(item.text.split())>20:continue
        # Require a source line whose typographic style agrees with an existing
        # lettered heading; scans lacking font evidence stay flagged, not guessed.
        p=item.prov[0]; page=pdf[p.page_no-1]
        box=p.bbox.to_top_left_origin(page.rect.height)
        spans=[s for b in page.get_text("dict")["blocks"] if "lines" in b for line in b["lines"] for s in line["spans"]
               if pymupdf.Rect(s['bbox']).intersects(pymupdf.Rect(box.l,box.t,box.r,box.b))]
        styled=bool(spans) and any("italic" in s['font'].lower() or 'oblique' in s['font'].lower() for s in spans)
        siblings=[r.resolve(doc) for r in item.parent.resolve(doc).children if r.cref!=item.self_ref]
        numeric_siblings=[s for s in siblings if re.fullmatch(r"\d+[.)]",getattr(s,'marker','')) and s.prov and s.prov[0].page_no==p.page_no]
        across_columns=bool(numeric_siblings) and box.l>page.rect.width/2 and all(s.prov[0].bbox.r<page.rect.width/2 for s in numeric_siblings)
        if not (styled or across_columns):continue
        replacement=SectionHeaderItem(self_ref=item.self_ref,parent=doc.body.get_ref(),children=item.children,
            label=DocItemLabel.SECTION_HEADER,prov=item.prov,orig=item.orig,text=f"{marker} {item.text}",level=2)
        parent=item.parent.resolve(doc)
        parent.children=[r for r in parent.children if r.cref!=item.self_ref]
        doc.body.children.append(item.get_ref())
        doc.texts[i]=replacement
        fixes.append({"kind":"list_to_heading","id":item.self_ref,"text":replacement.text})

    # Separate a source email from unrelated text that Docling merged into it.
    # Native source words provide the boundary; raw charspans can be inaccurate.
    for item in list(doc.texts):
        if item.label!=DocItemLabel.TEXT or len(item.prov)<2 or item.prov[0].page_no!=1:continue
        prov=item.prov[0];b=prov.bbox.to_top_left_origin(pdf[0].rect.height)
        words=[w[4] for w in pdf[0].get_text('words') if b.l-2<=(w[0]+w[2])/2<=b.r+2 and b.t-2<=(w[1]+w[3])/2<=b.b+2]
        fragment=' '.join(words)
        if not re.fullmatch(r'[^\s@]+@[^\s@]+',fragment) or not item.text.startswith(fragment+' '):continue
        remainder=item.text[len(fragment):].strip()
        other=doc.add_text(label=DocItemLabel.TEXT,text=remainder,orig=remainder,parent=doc.body)
        other.prov=[p.model_copy(deep=True) for p in item.prov[1:]]
        for p in other.prov:p.charspan=(max(0,p.charspan[0]-len(fragment)-1),max(0,p.charspan[1]-len(fragment)-1))
        item.text=fragment;item.orig=fragment;item.prov=[prov];prov.charspan=(0,len(fragment))
        fixes.append({'kind':'separate_email_from_body','id':item.self_ref,'new_id':other.self_ref})

    # Source geometry is needed even when the title is late in raw reading order.
    title_refs=sorted(doc.body.children,key=lambda r:r.resolve(doc).prov[0].bbox.to_top_left_origin(pdf[0].rect.height).t
                      if getattr(r.resolve(doc),'prov',[]) and r.resolve(doc).prov[0].page_no==1 else float('inf'))
    if any(x.label==DocItemLabel.TITLE for x in doc.texts):title_refs=[]
    for ref in title_refs:
        item=ref.resolve(doc)
        if item.label==DocItemLabel.SECTION_HEADER and item.prov and item.prov[0].page_no==1:
            b=item.prov[0].bbox.to_top_left_origin(pdf[0].rect.height)
            title_spans=[s for block in pdf[0].get_text('dict')['blocks'] for line in block.get('lines',[]) for s in line['spans']
                         if pymupdf.Rect(s['bbox']).intersects(pymupdf.Rect(b.l,b.t,b.r,b.b))]
            prominent=any(s['size']>=14 for s in title_spans)
            near_top=b.t < pdf[0].rect.height*(.30 if prominent else .16)
            if near_top and len(item.text)>=15 and not re.match(r"^(?:\d|[IVX]+[.)])",item.text):
                data=item.model_dump();data.pop('level',None);data['label']=DocItemLabel.TITLE
                doc.texts[int(item.self_ref.rsplit('/',1)[1])]=TitleItem.model_validate(data)
                fixes.append({"kind":"document_title","id":item.self_ref})
                break

    def bounds(item,page_no):
        prov=getattr(item,"prov",[])
        # A paragraph can continue from the bottom of the left column to the top
        # of the right. Its union bbox looks like a full-width block and reverses
        # reading order. Anchor atomic text/list units at their first source span.
        if prov:
            return prov[0].bbox.to_top_left_origin(pdf[page_no-1].rect.height) if prov[0].page_no==page_no else None
        for ref in item.children:
            b=bounds(ref.resolve(doc),page_no)
            if b:return b
        return None

    def content_length(item):
        return len(getattr(item,'text',''))+sum(content_length(r.resolve(doc)) for r in item.children)

    # Repair clear two-column regions. Wide figures/tables divide the page into
    # horizontal bands, so a simple global x/y sort cannot jump over them.
    original=list(doc.body.children);new=[];used=set()
    for number,page in enumerate(pdf,1):
        entries=[]
        for idx,ref in enumerate(original):
            if ref.cref in used:continue
            item=ref.resolve(doc);b=bounds(item,number)
            if b:entries.append((ref,item,b,idx))
        mid=page.rect.width/2
        narrow=[e for e in entries if e[2].r<=mid+10 or e[2].l>=mid-10]
        left=[e for e in narrow if e[2].r<=mid+10]
        right=[e for e in narrow if e[2].l>=mid-10]
        ordered=sorted(entries,key=lambda e:(round(e[2].t/3),e[2].l,e[3]))
        has_body_columns=any(content_length(e[1])>200 for e in left) and any(content_length(e[1])>200 for e in right)
        if len(left)>=3 and len(right)>=3 and has_body_columns:
            body_candidates=[e[2].t for e in narrow if len(getattr(e[1],'text',''))>250]
            start=min(body_candidates) if number==1 and body_candidates else 0
            prefix=[e for e in entries if e[2].b<=start]
            content=[e for e in entries if e not in prefix]
            wide=sorted([e for e in content if e[2].r-e[2].l > page.rect.width*.57],key=lambda e:e[2].t)
            remaining=[e for e in content if e not in wide]
            ordered=sorted(prefix,key=lambda e:(round(e[2].t/3),e[2].l,e[3]))
            def columns(es):
                return sorted(es,key=lambda e:(0 if (e[2].l+e[2].r)/2<mid else 1,e[2].t,e[3]))
            for barrier in wide:
                above=[e for e in remaining if e[2].b<=barrier[2].t+2]
                ordered+=columns(above)+[barrier]
                remaining=[e for e in remaining if e not in above]
            ordered+=columns(remaining)
            if [e[0].cref for e in ordered]!=[e[0].cref for e in entries]:
                fixes.append({"kind":"two_column_reading_order","page":number})
        elif [e[0].cref for e in ordered]!=[e[0].cref for e in entries]:
            fixes.append({'kind':'single_column_reading_order','page':number})
        for ref,_,_,_ in ordered:new.append(ref);used.add(ref.cref)
    new.extend(r for r in original if r.cref not in used)
    doc.body.children=new

    # A reference continued at the next column/page is one bibliography item.
    # Require bracketed neighbors, no marker, and a physical column/page break.
    for group in doc.groups:
        items=[r.resolve(doc) for r in group.children]
        for index in range(1,len(items)-1):
            prev,item,nxt=items[index-1:index+2]
            before=re.fullmatch(r"\[(\d+)\]",getattr(prev,'marker',''))
            after=re.fullmatch(r"\[(\d+)\]",getattr(nxt,'marker',''))
            if not before or not after or int(after[1])!=int(before[1])+1:continue
            if item.label!=DocItemLabel.LIST_ITEM or getattr(item,'marker','') or not item.prov or not prev.prov:continue
            pp,ip=prev.prov[-1],item.prov[0]
            pb=pp.bbox.to_top_left_origin(pdf[pp.page_no-1].rect.height)
            ib=ip.bbox.to_top_left_origin(pdf[ip.page_no-1].rect.height)
            column_break=ip.page_no==pp.page_no and pb.r<pdf[pp.page_no-1].rect.width/2 and ib.l>pdf[ip.page_no-1].rect.width/2 and ib.t<pb.t
            page_break=ip.page_no==pp.page_no+1 and ib.t<pdf[ip.page_no-1].rect.height*.3
            if not (column_break or page_break):continue
            offset=len(prev.text)+1
            prev.text+=' '+item.text;prev.orig+=' '+item.orig
            for prov in item.prov:
                copy=prov.model_copy(deep=True)
                copy.charspan=(copy.charspan[0]+offset,copy.charspan[1]+offset)
                prev.prov.append(copy)
            group.children=[r for r in group.children if r.cref!=item.self_ref]
            fixes.append({'kind':'reference_continuation','id':prev.self_ref,'absorbed':item.self_ref})

    headings=[x for x,_ in doc.iterate_items() if x.label==DocItemLabel.SECTION_HEADER]
    roman_paper=sum(bool(re.match(r"^[IVX]{2,}[.]\s*",x.text)) for x in headings)>=2
    current=1
    for item in headings:
        old_text=item.text;item.text=repair_small_caps(item.text)
        if item.text!=old_text:fixes.append({"kind":"small_caps","id":item.self_ref,"before":old_text,"after":item.text})
        old=item.level; text=item.text.strip()
        if roman_paper and re.match(r"^[IVX]+\.\s*",text):level=1
        elif roman_paper and re.match(r"^[A-Z]\.\s*",text):level=2
        elif roman_paper and re.match(r"^\d+\)",text):level=3
        elif m:=re.match(r"^(\d+(?:\.\d+)*)(?:\.?\s+)",text):level=m[1].count('.')+1
        elif re.match(r"^[A-Z](?:\.\d+)*\s+",text) and not roman_paper:
            # A / A.1 appendix numbering; an uppercase word is not a marker.
            marker=text.split()[0];level=marker.count('.')+1
        elif re.fullmatch(r"(?i)(references|bibliography|acknowledg(?:e)?ments?|abstract)",text):level=1
        else:
            level=max(current,old)
            warnings.append({"kind":"unnumbered_heading_level_inferred","id":item.self_ref,"text":text})
        item.level=min(level,100);current=item.level
        if old!=item.level:fixes.append({"kind":"heading_level","id":item.self_ref,"before":old,"after":item.level})

    # Repair indented bullets that the layout model left in a single flat list.
    # Numbered lists are excluded: their hanging indents are not nesting evidence.
    for group in list(doc.groups):
        items=[r.resolve(doc) for r in list(group.children)]
        if len(items)<2 or any(x.label!=DocItemLabel.LIST_ITEM or not x.prov or getattr(x,'enumerated',False) for x in items):continue
        base=min(x.prov[0].bbox.l for x in items)
        parent_item=None;subgroup=None
        for item in items:
            if item.prov[0].bbox.l <= base+10:
                parent_item=item;subgroup=None
            elif parent_item and item.prov[0].page_no==parent_item.prov[0].page_no:
                if subgroup is None:subgroup=doc.add_list_group(parent=parent_item)
                group.children=[r for r in group.children if r.cref!=item.self_ref]
                item.parent=subgroup.get_ref();subgroup.children.append(item.get_ref())
                fixes.append({"kind":"nested_bullet_indent","id":item.self_ref,"parent":parent_item.self_ref})
    return fixes,warnings
