"""Collect measured results and local review links without approving fidelity."""
from pathlib import Path
import html
import json
import re

from docling_core.types.doc import DoclingDocument
from evaluate import compare

ROOT=Path(__file__).resolve().parent

def main():
    gold=json.loads((ROOT/'expectations.json').read_text())
    results=[]
    candidates=[*(ROOT/'outputs/formulas-cached').glob('*/quality.json'),*(ROOT/'outputs/heldout-structure').glob('*/quality.json')]
    for path in sorted(candidates,key=lambda p:p.parent.name):
        name=path.parent.name
        folder=ROOT/'outputs/telemetry-fix'/name if name=='scikit-learn-scan' else path.parent
        updated=ROOT/'outputs/ocr-ordered'/name
        if (updated/'quality.json').exists() and json.loads((updated/'run.json').read_text()).get('state')=='converted':
            folder=updated
        run=json.loads((folder/'run.json').read_text())
        quality=json.loads((folder/'quality.json').read_text())
        evaluation=json.loads((folder/'evaluation.json').read_text())
        original=name.removesuffix('-scan').removesuffix('-mixed')
        raw=DoclingDocument.load_from_json(folder/'raw.json')
        raw_quality={'headings':[{'text':x.text,'level':x.level} for x,_ in raw.iterate_items() if x.label.value=='section_header'],
                     'figure_caption_numbers':sorted({int(m[1]) for x in raw.texts if x.label.value=='caption' and (m:=re.search(r'(?i)\bfig(?:ure)?\.?\s*(\d+)',x.text))})}
        raw_evaluation=compare(gold[original],raw_quality,run)
        md=(folder/'paper.md').read_text()
        image_links = re.findall(r'!\[[^\]]*\]\(([^)]+)\)',md) + re.findall(r'<img\b[^>]*\bsrc="([^"]+)"',md)
        missing_assets=[link for link in image_links if not (folder/html.unescape(link)).exists()]
        unmatched=[w for w in quality['warnings'] if w['kind'].endswith('export_not_matched')]
        log_path=ROOT/'logs'/folder.parent.name/(name+'.log')
        if folder.parent.name=='ocr-ordered':
            log_path=ROOT/'logs'/('ocr-ordered-camera.log' if name=='camera-ready-scan' else f'ocr-ordered-{name}.log')
        log=log_path.read_text() if log_path.exists() else ''
        table_warnings=[line for line in log.splitlines() if 'dropped from the table' in line or 'Orphan pdf_cell' in line]
        (folder/'runtime-warnings.json').write_text(json.dumps(table_warnings,indent=2))
        browser_path=folder/'browser-check.json'
        browser=json.loads(browser_path.read_text()) if browser_path.exists() else None
        result={'case':name,'pages':run['pages'],'output':str(folder.relative_to(ROOT)),
                'formula_recognition':run['formulas'],
                'parse_export_seconds':run['seconds'],'peak_process_gib':round(run['peak_rss_bytes']/1024**3,2),
                'raw_anchor_failures':len(raw_evaluation['failures']),
                'corrected_anchor_failures':len(evaluation['failures']),
                'heading_anchors':len(gold[original]['headings']),
                'token_recall':evaluation.get('digital_original_token_recall',quality['native_text_token_recall']),
                'equation_crops':md.count('![Original equation,'),
                'formula_candidates':len(json.loads((folder/'formula-candidates.json').read_text())),
                'inline_presentation':quality.get('inline_presentation'),
                'missing_assets':missing_assets,'unmatched_exports':unmatched,'browser':browser,
                'table_runtime_warning_lines':len(table_warnings),'approval':'needs_review'}
        results.append(result)
    (ROOT/'results.json').write_text(json.dumps(results,indent=2)+'\n')
    rows=[];mdrows=[]
    for r in results:
        out=r['output'];n=html.escape(r['case'])
        rows.append(f'<tr><td>{n}</td><td>{r["pages"]}</td><td><a href="inputs/{n}.pdf">PDF</a> · <a href="{out}/paper.md">Markdown</a> · <a href="{out}/review.html">Compare</a> · <a href="{out}/quality.json">Diagnostics</a></td></tr>')
        recall='—' if r['token_recall'] is None else f'{100*r["token_recall"]:.2f}%'
        mdrows.append(f'| [{r["case"]}]({out}/review.html) | {r["pages"]} | {"on" if r["formula_recognition"] else "off"} | {r["parse_export_seconds"]:.1f} | {r["peak_process_gib"]:.2f} | {r["raw_anchor_failures"]} → {r["corrected_anchor_failures"]} | {recall} |')
    (ROOT/'MEASUREMENTS.md').write_text('# Local measurements\n\nCPU, two threads. Formula recognition is shown per run; the two later structure checks use it off. Time covers parsing and initial JSON/Markdown export, excluding review generation and process shutdown. RSS is peak per process, not total machine usage. Scan rows use their digital originals for token recall.\n\n| Case / visual comparison | Pages | Math model | Seconds | Peak GiB | Selected anchor failures: raw → corrected | Token recall (diagnostic only) |\n|---|---:|---|---:|---:|---:|---:|\n'+'\n'.join(mdrows)+'\n\nZero selected-anchor failures does not certify complete hierarchy, content, table or math fidelity. See [the full structural audit update](STRUCTURE_REPORT.md) and [original evaluation](REPORT.md). Raw and corrected outputs share the same immutable extraction run.\n')
    total_pages=sum(r['pages'] for r in results)
    (ROOT/'index.html').write_text('<!doctype html><html><meta charset="utf-8"><title>Docling local evaluation</title><style>body{max-width:1050px;margin:40px auto;padding:0 24px;font:17px/1.6 system-ui;color:#18273c}table{border-collapse:collapse;width:100%}td,th{padding:12px;text-align:left;border-bottom:1px solid #ddd}a{color:#175cb5}p{max-width:850px}</style><h1>Docling local evaluation</h1><p>'+f'{len(results)} PDFs · {total_pages} pages'+' · local inference. Open <b>Compare</b> to inspect the original pages beside the actual Markdown. All outputs still require fidelity review.</p><p><a href="EDGE_CASE_REPORT.md">Latest: edge cases and final checks</a> · <a href="INLINE_REPORT.md">Inline formatting</a> · <a href="STRUCTURE_REPORT.md">Complete structure audit</a> · <a href="REPORT.md">Original evaluation</a> · <a href="MEASUREMENTS.md">Measurements</a> · <a href="README.md">Run instructions</a></p><table><tr><th>Test case</th><th>Pages</th><th>Open locally</th></tr>'+''.join(rows)+'</table></html>')
    print(json.dumps({'cases':len(results),'pages':sum(r['pages'] for r in results),
                      'heading_anchors':sum(r['heading_anchors'] for r in results),
                      'anchor_failures':sum(r['corrected_anchor_failures'] for r in results),
                      'missing_assets':sum(len(r['missing_assets']) for r in results),
                      'unmatched_exports':sum(len(r['unmatched_exports']) for r in results)},indent=2))

if __name__=='__main__':main()
