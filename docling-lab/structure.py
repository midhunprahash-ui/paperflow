"""Source-grounded structural repairs and an explicit section/content inventory."""
from __future__ import annotations

import re


def repair_structure(doc, pdf):
    from docling_core.types.doc import DocItemLabel, Formatting, ListItem, SectionHeaderItem, TextItem

    fixes = []

    # Terminal acknowledgements sections can be run-in headings, or can carry
    # the source paper's spelling variation. Preserve the wording, recover scope.
    for item, _ in list(doc.iterate_items()):
        match = re.match(r'^(acknow[a-z]{0,8}ments?)\b[.:]?\s*(.*)$', getattr(item, 'text', ''), re.I | re.S)
        if not match or not item.prov or item.prov[0].page_no < len(pdf)/2:
            continue
        if item.label == DocItemLabel.SECTION_HEADER and not match[2]:
            if item.level != 1:
                fixes.append({'kind':'terminal_section_level', 'id':item.self_ref, 'before':item.level, 'after':1})
                item.level = 1
        elif item.label == DocItemLabel.TEXT and match[2] and item.parent and item.parent.cref == '#/body':
            p = item.prov[0]
            page = pdf[p.page_no-1]
            b = p.bbox.to_top_left_origin(page.rect.height)
            spans = [s for block in page.get_text('dict')['blocks'] for line in block.get('lines',[]) for s in line['spans']
                     if match[1].lower() in s['text'].lower()
                     and (s['flags'] & 16 or re.search(r'(?i)bold|(?:^|[-_])(?:medi|demi)(?:$|[-_])',s['font']))
                     and b.l-3 <= s['bbox'][0] <= b.r and abs(s['bbox'][1]-b.t) < 5]
            if not spans:
                continue
            body = doc.add_text(label=DocItemLabel.TEXT, text=match[2], orig=match[2], parent=doc.body)
            body.prov = [p.model_copy(deep=True) for p in item.prov]
            body.prov[0].charspan = (0, len(match[2]))
            data = item.model_dump()
            data.update(label=DocItemLabel.SECTION_HEADER, text=match[1], orig=match[1], level=1)
            heading = SectionHeaderItem.model_validate(data)
            heading.prov[0] = heading.prov[0].model_copy(deep=True)
            heading.prov[0].charspan = (0,len(match[1]))
            doc.texts[int(item.self_ref.rsplit('/',1)[1])] = heading
            doc.body.children = [r for r in doc.body.children if r.cref != body.self_ref]
            index = next(i for i,r in enumerate(doc.body.children) if r.cref == item.self_ref)
            doc.body.children.insert(index+1, body.get_ref())
            fixes.append({'kind':'source_run_in_section', 'id':item.self_ref, 'body_id':body.self_ref})

    def replace_as_text(item, reason):
        data = item.model_dump()
        data.pop('level', None)
        data.update(label=DocItemLabel.TEXT, formatting=Formatting(bold=True))
        replacement = TextItem.model_validate(data)
        doc.texts[int(item.self_ref.rsplit('/', 1)[1])] = replacement
        fixes.append({'kind': reason, 'id': item.self_ref, 'text': item.text})

    # A sentence introducing an actual list is not an additional section.
    leaves = [x for x, _ in doc.iterate_items()]
    for i, item in enumerate(leaves[:-1]):
        if item.label != DocItemLabel.SECTION_HEADER:
            continue
        if (re.search(r'(?i)\b(?:includes?|following|consists? of)\b', item.text)
                and re.search(r':\s*-?\s*$', item.text)
                and not re.match(r'^(?:\d|[A-Z][.)])', item.text)
                and leaves[i+1].label == DocItemLabel.LIST_ITEM):
            replace_as_text(item, 'list_introduction_is_not_heading')

    leaves = [x for x, _ in doc.iterate_items()]
    boundary = next((i for i, x in enumerate(leaves)
                     if re.match(r'(?i)^abstract\b', getattr(x, 'text', ''))
                     or (x.label == DocItemLabel.SECTION_HEADER
                         and re.match(r'^(?:1[. ]|I\.\s)', x.text))), None)
    front_ids = {x.self_ref for x in leaves[:boundary]} if boundary is not None else set()
    if boundary is not None:
        front = leaves[:boundary]
        has_authors = any('@' in getattr(x, 'text', '') for x in front)
        if has_authors:
            for item in front:
                if (item.label == DocItemLabel.SECTION_HEADER and item.prov
                        and item.prov[0].page_no <= 2 and len(item.text.split()) <= 10):
                    replace_as_text(item, 'front_matter_is_not_section')

        # Link email/ORCID blocks to the author column they occupy. Only reorder
        # a clear row of 2-4 separate author blocks; do not guess merged metadata.
        candidates = []
        for item in front:
            if item.label not in (DocItemLabel.TEXT, DocItemLabel.SECTION_HEADER) or not item.prov:
                continue
            p = item.prov[0]
            if p.page_no != 1 or '@' in item.text and len(item.text.split()) < 3:
                continue
            b = p.bbox.to_top_left_origin(pdf[0].rect.height)
            if b.r-b.l < pdf[0].rect.width*.30 and len(item.text.split()) >= 3:
                candidates.append((item, b))
        if candidates:
            top = min(b.t for _, b in candidates)
            anchors = sorted([(x, b) for x, b in candidates if abs(b.t-top) < 4], key=lambda pair:pair[1].l)
            if 2 <= len(anchors) <= 4 and all(b.l-a.r > 10 for (_, a), (_, b) in zip(anchors, anchors[1:])):
                grouped = {x.self_ref: [] for x, _ in anchors}
                for item in front:
                    if item.label == DocItemLabel.TITLE or not item.prov:
                        continue
                    p = item.prov[0]
                    if p.page_no != 1:
                        continue
                    b = p.bbox.to_top_left_origin(pdf[0].rect.height)
                    if b.t < top-4 or b.r-b.l > pdf[0].rect.width*.35:
                        continue
                    owner, _ = min(anchors, key=lambda a:abs((a[1].l+a[1].r)-(b.l+b.r)))
                    grouped[owner.self_ref].append(item)
                ids = {x.self_ref for group in grouped.values() for x in group}
                ownership = {x.self_ref:key for key, xs in grouped.items() for x in xs}
                def descendants(item):
                    if item.self_ref in ids:
                        return {item.self_ref}
                    return set().union(*(descendants(r.resolve(doc)) for r in item.children)) if item.children else {item.self_ref}
                units = []
                covered = set()
                for index, ref in enumerate(doc.body.children):
                    members = descendants(ref.resolve(doc))
                    owners = {ownership[m] for m in members if m in ids}
                    if members <= ids and len(owners) == 1:
                        units.append((index, ref, owners.pop()))
                        covered.update(members)
                if covered == ids:
                    first = min(i for i, _, _ in units)
                    unit_ids = {r.cref for _, r, _ in units}
                    remaining = [r for r in doc.body.children if r.cref not in unit_ids]
                    ordered = [r for owner, _ in anchors for _, r, key in units if key == owner.self_ref]
                    doc.body.children = remaining[:first] + ordered + remaining[first:]
                    fixes.append({'kind': 'author_column_associations',
                                  'groups': {key:[x.self_ref for x in xs] for key, xs in grouped.items()}})

    def absorb(previous, item, kind):
        separator = '' if previous.text.endswith('-') else ' '
        offset = len(previous.text) + len(separator)
        previous.text += separator + item.text
        previous.orig += separator + item.orig
        for p in item.prov:
            p = p.model_copy(deep=True)
            p.charspan = (p.charspan[0]+offset, p.charspan[1]+offset)
            previous.prov.append(p)
        parent = item.parent.resolve(doc)
        parent.children = [r for r in parent.children if r.cref != item.self_ref]
        item.parent = None
        fixes.append({'kind':kind, 'id':previous.self_ref, 'absorbed':item.self_ref})

    retained = []
    for item, _ in list(doc.iterate_items()):
        previous = retained[-1] if retained else None
        merged = False
        if (previous and item.label == DocItemLabel.TEXT
                and previous.label in (DocItemLabel.TEXT, DocItemLabel.LIST_ITEM)
                and previous.prov and item.prov
                and item.self_ref not in front_ids and previous.self_ref not in front_ids):
            pp, ip = previous.prov[-1], item.prov[0]
            ph, ih = pdf[pp.page_no-1].rect.height, pdf[ip.page_no-1].rect.height
            pb, ib = pp.bbox.to_top_left_origin(ph), ip.bbox.to_top_left_origin(ih)
            same_column = ip.page_no == pp.page_no and abs(pb.l-ib.l) < 25
            nearby = same_column and 0 <= ib.t-pb.b <= 7
            column_break = (ip.page_no == pp.page_no and pb.b > ph*.85 and ib.t < ih*.4
                            and pb.r < pdf[pp.page_no-1].rect.width/2 < ib.l)
            page_break = ip.page_no == pp.page_no+1 and pb.b > ph*.85 and ib.t < ih*.2
            url = re.fullmatch(r'https?://\S+', item.text.strip())
            reference_url = (url and re.fullmatch(r'\[\d+\]', getattr(previous, 'marker', ''))
                             and same_column and -2 <= ib.t-pb.b <= 7)
            continuation = (item.text[:1].islower() and not re.search(r'[.!?:;][\s\"\x27]*$', previous.text)
                            and (column_break or page_break or (nearby and len(item.text.split()) <= 4)))
            if reference_url or continuation:
                absorb(previous, item, 'reference_url_attached' if reference_url else 'source_continuation_joined')
                merged = True
        if not merged:
            retained.append(item)

    # Consecutively numbered prose blocks are list items, not section headings.
    leaves = [x for x, _ in doc.iterate_items()]
    i = 0
    while i < len(leaves):
        sequence = []
        j = i
        while j < len(leaves):
            item = leaves[j]
            m = re.match(r'^(\d+)([.)])\s+(\S.*)$', getattr(item, 'text', ''), re.S)
            if (item.label != DocItemLabel.TEXT or not m or not item.parent
                    or item.parent.cref != '#/body' or (sequence and int(m[1]) != sequence[-1][1]+1)):
                break
            sequence.append((item, int(m[1]), m[1]+m[2], m[3]))
            j += 1
        if len(sequence) >= 2:
            group = doc.add_list_group(parent=doc.body)
            first = next(k for k, r in enumerate(doc.body.children) if r.cref == sequence[0][0].self_ref)
            ids = {x.self_ref for x, _, _, _ in sequence}
            doc.body.children = [r for r in doc.body.children if r.cref not in ids and r.cref != group.self_ref]
            doc.body.children.insert(first, group.get_ref())
            for item, _, marker, text in sequence:
                data = item.model_dump()
                data.update(label=DocItemLabel.LIST_ITEM, text=text, marker=marker,
                            enumerated=True, parent=group.get_ref())
                doc.texts[int(item.self_ref.rsplit('/', 1)[1])] = ListItem.model_validate(data)
                group.children.append(item.get_ref())
                fixes.append({'kind':'numbered_text_is_list', 'id':item.self_ref})
            i = j
        else:
            i += 1
    return fixes


def build_structure(doc, figure_tables=(), fixes=(), pdf=None, ocr_lines=()):
    """Build explicit section ownership; preserve source IDs and caption links."""
    sections, blocks, stack = [], [], []
    by_id = {}
    caption_owners = {r.cref:x.self_ref for x in [*doc.pictures, *doc.tables] for r in x.captions}
    metadata = {item:owner for fix in fixes if fix['kind']=='author_column_associations'
                for owner, items in fix['groups'].items() for item in items}
    front_role = 'metadata'
    ordered = []
    for item, _ in doc.iterate_items():
        if item.self_ref in caption_owners:
            continue
        captions = [r.resolve(doc) for r in getattr(item, 'captions', [])]
        above, below = [], []
        for caption in captions:
            is_above = False
            if item.prov and caption.prov and item.prov[0].page_no == caption.prov[0].page_no:
                height = doc.pages[item.prov[0].page_no].size.height
                is_above = caption.prov[0].bbox.to_top_left_origin(height).b <= item.prov[0].bbox.to_top_left_origin(height).t+2
            (above if is_above else below).append(caption)
        ordered.extend([*above, item, *below])
    for item in ordered:
        label = item.label.value
        if label == 'section_header':
            while stack and stack[-1]['level'] >= item.level:
                stack.pop()
            section = {'id':item.self_ref, 'title':item.text, 'level':item.level,
                       'parent':stack[-1]['id'] if stack else None, 'children':[], 'blocks':[]}
            if stack:
                stack[-1]['children'].append(section['id'])
            sections.append(section)
            stack.append(section)
        if not stack and label == 'text':
            if re.match(r'(?i)^abstract\b', item.text):
                front_role = 'abstract'
            elif re.match(r'(?i)^keywords', item.text):
                front_role = 'keywords'
        kind = 'figure' if label == 'picture' or item.self_ref in figure_tables else label
        caption_of = caption_owners.get(item.self_ref)
        owner = by_id.get(caption_of)
        path = owner['section_path'] if owner else [s['title'] for s in stack]
        section_id = owner['section_id'] if owner else stack[-1]['id'] if stack else None
        block = {'id':item.self_ref, 'kind':kind, 'text':getattr(item, 'text', None),
                 'marker':getattr(item, 'marker', None), 'section_id':section_id,
                 'section_path':path, 'front_matter_role':front_role if not stack else None,
                 'metadata_group':metadata.get(item.self_ref), 'caption_of':caption_of,
                 'list_id':item.parent.cref if label=='list_item' and item.parent else None,
                 'provenance':[p.model_dump(mode='json') for p in item.prov]}
        if label == 'formula' and pdf is not None and item.prov:
            p = item.prov[0]
            page = pdf[p.page_no-1]
            b = p.bbox.to_top_left_origin(page.rect.height)
            words = [w[4] for w in page.get_text('words') if b.l-3 <= (w[0]+w[2])/2 <= b.r+3 and b.t-3 <= (w[1]+w[3])/2 <= b.b+3]
            numbers = re.findall(r'\((\d+)\)', ''.join(words))
            block['source_equation_number'] = int(numbers[-1]) if numbers else None
            if not numbers and not page.get_text().strip():
                candidates=[c for c in ocr_lines if c['page']==p.page_no and c['confidence']>=.99
                            and re.fullmatch(r'\(\d+\)',c['text'].strip())
                            and b.r-max(20,(b.r-b.l)*.15)<=(c['bbox'][0]+c['bbox'][2])/2<=b.r+3
                            and b.t-3<=(c['bbox'][1]+c['bbox'][3])/2<=b.b+3]
                if len(candidates)==1:
                    block['source_equation_number']=int(candidates[0]['text'].strip()[1:-1])
                    block['equation_number_evidence']={'method':'ocr_right_margin_label','confidence':candidates[0]['confidence'],
                                                       'bbox':candidates[0]['bbox']}
        by_id[item.self_ref] = block
        blocks.append(block)
        if stack and label != 'section_header':
            next(s for s in sections if s['id']==section_id)['blocks'].append(item.self_ref)
    return {'schema_version':1, 'status':'experimental', 'sections':sections, 'blocks':blocks,
            'limits':'Explicit source-order ownership, not semantic/math/OCR certification. Unmarked section endings remain ambiguous.'}
