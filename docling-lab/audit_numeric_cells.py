"""Compare eligible native numeric cells with independent PDF word positions."""
from pathlib import Path
import json
import re

ROOT=Path(__file__).resolve().parent


def audit():
    import pymupdf as m
    matches=[];failures=[]
    for case in json.loads((ROOT/'results.json').read_text()):
        if case['case'].endswith(('-scan','-mixed')):continue
        out=ROOT/case['output'];doc=json.loads((out/'document.json').read_text());run=json.loads((out/'run.json').read_text())
        with m.open(run['input']) as pdf:
            words={i+1:p.get_text('words') for i,p in enumerate(pdf)}
            for table in doc['tables']:
                if not table['prov']:continue
                page_no=table['prov'][0]['page_no'];page=pdf[page_no-1]
                for cell in table['data']['table_cells']:
                    if not re.fullmatch(r'[-+]?\d+(?:\.\d+)?%?',cell['text'].strip()) or not cell.get('bbox'):continue
                    b=cell['bbox'];top,bottom=(b['t'],b['b']) if b['coord_origin']=='TOPLEFT' else (page.rect.height-b['t'],page.rect.height-b['b'])
                    rect=m.Rect(b['l']-.4,top-.4,b['r']+.4,bottom+.4)
                    selected=[w[4] for w in words[page_no] if rect.contains(m.Point((w[0]+w[2])/2,(w[1]+w[3])/2))]
                    if not selected:continue
                    record=dict(case=case['case'],table=table['self_ref'],page=page_no,row=cell['start_row_offset_idx'],
                                col=cell['start_col_offset_idx'],output=cell['text'],source_words=selected)
                    matches.append(record)
                    if re.sub(r'\s+','',''.join(selected))!=re.sub(r'\s+','',cell['text']):failures.append(record)
    return dict(status='fail' if failures else 'pass',checked_cells=len(matches),failures=failures,matches=matches,
                limits='Native numeric cells with usable independent word geometry only. No claim about omitted cells, all row/column semantics, textual cells, merged matrices, or scanned-cell OCR.')


if __name__=='__main__':
    result=audit();(ROOT/'numeric-cell-audit.json').write_text(json.dumps(result,indent=2))
    print(json.dumps({k:result[k] for k in ('status','checked_cells','failures')},indent=2))
    if result['failures']:raise SystemExit(1)
