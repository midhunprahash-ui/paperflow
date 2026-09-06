"""Recover explicitly ruled native tables and audit structured cell occupancy."""
from __future__ import annotations
from native_pdf import native_dict
from collections import defaultdict
import html
import json
import re


def clusters(values, tolerance=.6):
    groups = []
    for value in sorted(values):
        if groups and value-groups[-1][-1] <= tolerance:
            groups[-1].append(value)
        else: groups.append([value])
    return [sum(g)/len(g) for g in groups]


def covered(intervals, start, end, tolerance=.7):
    pieces = sorted((max(start,a),min(end,b)) for a,b in intervals if b>=start and a<=end)
    cursor = start
    for a,b in pieces:
        if a > cursor+tolerance: return False
        cursor = max(cursor,b)
    return cursor >= end-tolerance


def ruled_grid(page, bbox):
    import pymupdf as m
    horizontal, vertical = [], []
    for drawing in page.get_drawings():
        if not (drawing['rect']+(-.2,-.2,.2,.2)).intersects(bbox): continue
        for item in drawing['items']:
            segments = []
            if item[0]=='l': segments=[(item[1].x,item[1].y,item[2].x,item[2].y)]
            elif item[0]=='re':
                r=item[1]
                if r.height<1: segments=[(r.x0,(r.y0+r.y1)/2,r.x1,(r.y0+r.y1)/2)]
                elif r.width<1: segments=[((r.x0+r.x1)/2,r.y0,(r.x0+r.x1)/2,r.y1)]
            for x0,y0,x1,y1 in segments:
                if not (bbox.x0-2<=min(x0,x1) and max(x0,x1)<=bbox.x1+2 and bbox.y0-2<=min(y0,y1) and max(y0,y1)<=bbox.y1+2): continue
                if abs(y0-y1)<.3 and abs(x1-x0)>.65*bbox.width:
                    horizontal.append(((y0+y1)/2,min(x0,x1),max(x0,x1)))
                if abs(x0-x1)<.3 and abs(y1-y0)>2:
                    vertical.append(((x0+x1)/2,min(y0,y1),max(y0,y1)))
    # Paired header rules are one separator, not an empty data row.
    ys=clusters((h[0] for h in horizontal),tolerance=2.0)
    if len(ys)<3: return None
    left=min(h[1] for h in horizontal);right=max(h[2] for h in horizontal)
    xs=[left,right]
    for x in clusters(v[0] for v in vertical):
        intervals=[(a,b) for vx,a,b in vertical if abs(vx-x)<.7]
        # Real cell dividers connect row rules; formula brackets do not.
        if any(covered(intervals,a,b) for a,b in zip(ys,ys[1:])) and left+.8<x<right-.8: xs.append(x)
    xs=sorted(xs);rows=len(ys)-1;cols=len(xs)-1
    if cols<2 or rows*cols>2000: return None
    parents=list(range(rows*cols))
    def root(i):
        while parents[i]!=i:
            parents[i]=parents[parents[i]];i=parents[i]
        return i
    def union(a,b):parents[root(b)]=root(a)
    for r in range(rows):
        for c in range(cols):
            idx=r*cols+c
            if c+1<cols and not covered([(a,b) for x,a,b in vertical if abs(x-xs[c+1])<.7],ys[r],ys[r+1]):union(idx,idx+1)
            if r+1<rows and not covered([(a,b) for y,a,b in horizontal if abs(y-ys[r+1])<.7],xs[c],xs[c+1]):union(idx,idx+cols)
    groups=defaultdict(list)
    for idx in range(rows*cols):groups[root(idx)].append(divmod(idx,cols))
    cells=[]
    chars=[ch for b in native_dict(page, raw=True)['blocks'] for line in b.get('lines',[]) for span in line['spans'] for ch in span['chars']]
    for group in groups.values():
        r0=min(r for r,c in group);r1=max(r for r,c in group)+1;c0=min(c for r,c in group);c1=max(c for r,c in group)+1
        if len(group)!=(r1-r0)*(c1-c0):return None
        rect=m.Rect(xs[c0],ys[r0],xs[c1],ys[r1])
        text=''.join(ch['c'] for ch in chars if rect.contains(m.Point((ch['bbox'][0]+ch['bbox'][2])/2,(ch['bbox'][1]+ch['bbox'][3])/2)))
        cells.append(dict(start_row_offset_idx=r0,end_row_offset_idx=r1,start_col_offset_idx=c0,end_col_offset_idx=c1,
                          row_span=r1-r0,col_span=c1-c0,column_header=r0==0,text=text.strip(),
                          bbox=dict(l=rect.x0,t=rect.y0,r=rect.x1,b=rect.y1,coord_origin='TOPLEFT')))
    if sum(bool(c['text']) for c in cells)<.65*len(cells):return None
    return dict(num_rows=rows,num_cols=cols,table_cells=cells,x_lines=xs,y_lines=ys)


def occupancy(data):
    grid=[[[] for _ in range(data.num_cols)] for _ in range(data.num_rows)]
    errors=[]
    for n,c in enumerate(data.table_cells):
        r0,r1,c0,c1=c.start_row_offset_idx,c.end_row_offset_idx,c.start_col_offset_idx,c.end_col_offset_idx
        if not (0<=r0<r1<=data.num_rows and 0<=c0<c1<=data.num_cols) or c.row_span!=r1-r0 or c.col_span!=c1-c0:
            errors.append({'kind':'invalid_cell_span','cell':n});continue
        for r in range(r0,r1):
            for col in range(c0,c1):grid[r][col].append(n)
    for r,row in enumerate(grid):
        for c,owners in enumerate(row):
            if len(owners)!=1:errors.append({'kind':'missing_or_overlapping_cell','row':r,'col':c,'owners':owners})
    return errors


def repair_tables(doc,pdf,out):
    import pymupdf as m
    from docling_core.types.doc import TableData
    repairs={};audit=[];fixes=[]
    for table in doc.tables:
        if len(table.prov)!=1:continue
        captions=[r.resolve(doc).text for r in table.captions]
        if captions and re.match(r'(?i)^fig(?:ure)?\.?\s*\d',captions[0]):continue
        prov=table.prov[0];page=pdf[prov.page_no-1];b=prov.bbox.to_top_left_origin(page.rect.height)
        grid=ruled_grid(page,m.Rect(b.l,b.t,b.r,b.b))
        changed=False
        # Require a meaningful structural discrepancy; leave known-good inferred
        # borderless tables and matching TableFormer grids intact.
        if grid and grid['num_rows']>=table.data.num_rows and (grid['num_rows'],grid['num_cols'])!=(table.data.num_rows,table.data.num_cols):
            before=table.data.model_dump(mode='json')
            table.data=TableData.model_validate({k:v for k,v in grid.items() if k not in ('x_lines','y_lines')})
            if occupancy(table.data):
                table.data=TableData.model_validate(before)
            else:
                changed=True;rows=[];cells=[]
                for r in range(table.data.num_rows):
                    columns=[]
                    for n,c in enumerate(table.data.table_cells):
                        if c.start_row_offset_idx!=r:continue
                        rect=m.Rect(c.bbox.l,c.bbox.t,c.bbox.r,c.bbox.b)
                        asset=f'assets/table-{table.self_ref.split("/")[-1]}-cell-{n}.png'
                        # Each cell remains structured; pixels preserve nested
                        # matrices, powers and brackets inside that cell.
                        page.get_pixmap(matrix=m.Matrix(4,4),clip=rect).save(out/asset)
                        alt='Original table cell; unverified text: '+c.text
                        columns.append(f'<td rowspan="{c.row_span}" colspan="{c.col_span}"><img src="{asset}" alt="{html.escape(alt,quote=True)}"></td>')
                        cells.append(dict(index=n,row=c.start_row_offset_idx,col=c.start_col_offset_idx,row_span=c.row_span,col_span=c.col_span,
                                          bbox=list(rect),source_image=asset,text=c.text,text_verified=False))
                    rows.append('<tr>'+''.join(columns)+'</tr>')
                repairs[table.self_ref]=dict(html='<table>\n'+ '\n'.join(rows)+'\n</table>',cells=cells,
                    source_page=prov.page_no,original_grid=before,grid_lines={'x':grid['x_lines'],'y':grid['y_lines']})
                fixes.append(dict(kind='source_ruled_table_grid',id=table.self_ref,rows=table.data.num_rows,cols=table.data.num_cols))
        checks=occupancy(table.data)
        audit.append(dict(id=table.self_ref,page=prov.page_no,rows=table.data.num_rows,cols=table.data.num_cols,
                          errors=[e for e in checks if e['kind']=='invalid_cell_span' or e.get('owners')],
                          unassigned_slots=[e for e in checks if e.get('owners')==[]],source_ruled_repair=changed,
                          transcription_status='unverified'))
    (out/'table-content.json').write_text(json.dumps(dict(schema_version=1,repairs=repairs,audit=audit,
        limits='Overlapping/out-of-range cells are errors. Unassigned slots are reported separately: they can be intended blanks or extraction omissions, so they remain unverified. Grid checks do not prove cell transcription. Repaired ruled tables retain source images per structured cell; native text alternatives remain unverified.'),indent=2,ensure_ascii=False))
    return repairs,fixes
