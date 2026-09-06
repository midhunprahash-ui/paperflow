"""Restore visible native punctuation only when every letter/digit agrees."""
from native_pdf import native_dict
from collections import defaultdict
import re
import unicodedata


def compact(text):return re.sub(r'\s+','',unicodedata.normalize('NFKC',text))


def restore_native_punctuation(doc,pdf):
    pages={};fixes=[]
    for item,_ in doc.iterate_items():
        if item.label.value!='text' or not item.prov or item.children:continue
        pieces=[];seen=set();valid=True
        for prov in item.prov:
            page=pdf[prov.page_no-1]
            if prov.page_no not in pages:pages[prov.page_no]=native_dict(page, raw=True)
            b=prov.bbox.to_top_left_origin(page.rect.height)
            rows=[]
            for block in pages[prov.page_no]['blocks']:
                for line in block.get('lines',[]):
                    if abs(line['dir'][0]-1)>.001 or abs(line['dir'][1])>.001:continue
                    chars=[]
                    for span in line['spans']:
                        for char in span['chars']:
                            box=char['bbox'];key=(prov.page_no,*char['origin'],char['c'])
                            if key not in seen and b.l-1<=(box[0]+box[2])/2<=b.r+1 and b.t-2<=(box[1]+box[3])/2<=b.b+2:
                                chars.append(char['c']);seen.add(key)
                    if ''.join(chars).strip():rows.append(''.join(chars).strip())
            if not rows:valid=False;break
            pieces.extend(rows)
        if not valid:continue
        text=''
        for piece in pieces:
            text+=('' if not text or text.endswith('-') else ' ')+piece
        if any(ord(c)<32 and not c.isspace() for c in text):continue
        before,after=compact(item.text),compact(text)
        letters=lambda s:''.join(c for c in s if c.isalnum())
        if before!=after and letters(before)==letters(after):
            fixes.append(dict(kind='native_visible_punctuation',id=item.self_ref,before=item.text,after=text))
            item.text=text
            if len(item.prov)==1:item.prov[0].charspan=(0,len(text))
    return fixes
