"""Explicit six-paper benchmark; cloud outputs stay in ignored tmp/, never production."""
import argparse
import base64
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parent
OUT = ROOT.parent / 'tmp/cloud-ocr-benchmark'
CASES = ['attention', 'resnet', 'bert', 'scikit-learn', 'alexnet', 'scikit-learn-scan']

def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False))

def az(*args):
    return json.loads(subprocess.check_output(['az', *args, '-o', 'json'], stderr=subprocess.DEVNULL))

def request(url, headers, body=None):
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers), timeout=180) as r:
            raw = r.read()
            return (json.loads(raw) if raw else {}, dict(r.headers))
    except urllib.error.HTTPError as error:
        # Do not expose provider responses or credentials in console output.
        raise RuntimeError('Provider HTTP ' + str(error.code)) from None

def tokens(text):
    return re.findall(r'\w+', unicodedata.normalize('NFKC', text).casefold())

def canonical(text):
    return ''.join(tokens(text))

def metrics(case, provider, out):
    import pymupdf
    expected = json.loads((ROOT/'expectations.json').read_text())[case.removesuffix('-scan')]
    if provider == 'docling':
        raw = json.loads((out/'raw.json').read_text())
        run = json.loads((out/'run.json').read_text())
        text = ' '.join(t.get('text', '') for t in raw['texts'])
        text += ' ' + ' '.join(c.get('text', '') for t in raw['tables'] for c in t['data']['table_cells'])
        quality = json.loads((out/'quality.json').read_text())
        headings = [h['text'] for h in quality['headings']]
        pages, tables, figures = run['pages'], len(raw['tables']), len(raw.get('pictures', []))
        formulas = sum(t.get('label') == 'formula' for t in raw['texts'])
    else:
        raw = json.loads((out/'response.json').read_text())
        if provider == 'azure':
            r = raw['analyzeResult']; text = r['content']
            headings = [p['content'] for p in r.get('paragraphs', []) if p.get('role') in ('title', 'sectionHeading')]
            pages, tables, figures = len(r['pages']), len(r.get('tables', [])), len(r.get('figures', []))
            formulas = sum(len(p.get('formulas', [])) for p in r['pages'])
        else:
            pages = len(raw['pages'])
            text = '\n'.join(p['markdown'] + '\n' + '\n'.join(t.get('content', '') for t in p.get('tables', [])) for p in raw['pages'])
            headings = re.findall(r'^#{1,6}\s+(.+)$', text, re.M)
            tables = sum(len(p.get('tables', [])) for p in raw['pages'])
            figures = sum(len(p.get('images', [])) for p in raw['pages'])
            formulas = None
        (out/'paper.md').write_text(text)
    source = ROOT/'inputs'/(case.removesuffix('-scan')+'.pdf')
    with pymupdf.open(source) as pdf:
        original = Counter(tokens('\n'.join(p.get_text() for p in pdf)))
    extracted = Counter(tokens(re.sub(r'</?(?:table|tr|td|th|thead|tbody|caption|figure|figcaption|p|br)(?:\s[^<>]*)?/?>', ' ', text, flags=re.I)))
    matched, missing, positions = [], [], []
    for _, title in expected['headings']:
        candidates = [(len(h), i) for i,h in enumerate(headings) if canonical(title) in canonical(h)]
        if candidates:
            matched.append(title); positions.append(min(candidates)[1])
        else:
            missing.append(title)
    return dict(pages=pages,expected_pages=expected['pages'], token_recall_proxy=round(sum((original & extracted).values())/max(1,sum(original.values())),4),
        heading_anchors_matched=len(matched),heading_anchors_total=len(expected['headings']),missing_headings=missing,
        heading_order_inversions=sum(b<a for a,b in zip(positions,positions[1:])),
        tables_detected=tables,expected_tables=expected.get('tables'),figures_detected=figures,expected_figures=expected.get('figures'),
        formula_regions=formulas, note='Token overlap and selected heading anchors only; not semantic accuracy. Region counts are not fidelity scores.')

def main():
    p=argparse.ArgumentParser();p.add_argument('provider',choices=['azure','mistral','docling']);p.add_argument('--cases',nargs='+',choices=CASES,default=CASES);a=p.parse_args()
    OUT.mkdir(parents=True,exist_ok=True)
    headers={}; endpoint=''
    if a.provider=='azure':
        info=az('cognitiveservices','account','show','-g','rpaper-staging','-n','rpaper-ocr-benchmark')
        endpoint=info['properties']['endpoint'].rstrip('/')
        key=az('cognitiveservices','account','keys','list','-g','rpaper-staging','-n','rpaper-ocr-benchmark')['key1']
        headers={'Ocp-Apim-Subscription-Key':key,'Content-Type':'application/json'}
    if a.provider=='mistral':
        # Node's dotenv parser handles quoted values without exposing other secrets.
        code="const fs=require('fs');const e=require('node:util').parseEnv(fs.readFileSync('.env.local','utf8'));process.stdout.write(e.MISTRAL_API_KEY||'')"
        key=os.environ.get('MISTRAL_API_KEY') or subprocess.check_output(['node','-e',code],cwd=ROOT.parent).decode().strip()
        if not key: raise SystemExit('Missing MISTRAL_API_KEY in environment or ignored .env.local')
        headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'}
    for case in a.cases:
        out=OUT/a.provider/case; out.mkdir(parents=True,exist_ok=True)
        pdf=ROOT/'inputs'/(case+'.pdf'); sha=hashlib.sha256(pdf.read_bytes()).hexdigest()
        if (out/'measurement.json').exists():
            old=json.loads((out/'measurement.json').read_text())
            if old['sha256']!=sha: raise SystemExit('Input changed; use a fresh output folder')
            print(a.provider,case,'existing',flush=True);continue
        started=time.monotonic(); print(a.provider,case,'starting',flush=True)
        if a.provider=='docling':
            with (out/'process.log').open('w') as log:
                subprocess.run([sys.executable,str(ROOT/'app_parse.py'),str(pdf),'--output',str(out)],stdout=log,stderr=subprocess.STDOUT,check=True,timeout=1200)
        elif a.provider=='azure':
            params=urllib.parse.urlencode({'api-version':'2024-11-30','outputContentFormat':'markdown','output':'figures','features':'formulas'})
            _, response_headers=request(endpoint+'/documentintelligence/documentModels/prebuilt-layout:analyze?'+params,headers,{'base64Source':base64.b64encode(pdf.read_bytes()).decode()})
            operation=next(v for k,v in response_headers.items() if k.lower()=='operation-location')
            if urllib.parse.urlparse(operation).netloc!=urllib.parse.urlparse(endpoint).netloc: raise RuntimeError('Unexpected operation origin')
            save(out/'operation.json',{'url':operation,'sha256':sha})
            while time.monotonic()-started<1200:
                time.sleep(2)
                result,_=request(operation,headers)
                if result['status']=='succeeded':break
                if result['status']=='failed':raise RuntimeError('Azure analysis failed')
            else:raise RuntimeError('Azure analysis deadline exceeded')
            save(out/'response.json',result)
        else:
            result,_=request('https://api.mistral.ai/v1/ocr',headers,{'model':'mistral-ocr-latest','document':{'type':'document_url','document_url':'data:application/pdf;base64,'+base64.b64encode(pdf.read_bytes()).decode()},'include_image_base64':True,'table_format':'html','include_blocks':True})
            save(out/'response.json',result)
        measurement=dict(provider=a.provider,case=case,sha256=sha,wall_seconds=round(time.monotonic()-started,2),
            timing_scope='Local process including export' if a.provider=='docling' else 'Client upload through complete result; Azure polling up to 2 seconds overhead; excludes figure downloads',
            model='Docling app_parse, CPU two threads' if a.provider=='docling' else 'prebuilt-layout 2024-11-30 + formulas' if a.provider=='azure' else result.get('model','mistral-ocr-latest'),
            metrics=metrics(case,a.provider,out))
        save(out/'measurement.json',measurement); print(json.dumps(measurement),flush=True)

if __name__=='__main__': main()
