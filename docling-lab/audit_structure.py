"""Audit the user's complete, manually source-reviewed structural inventory."""
from __future__ import annotations
import argparse
from collections import Counter
import hashlib
import html
import json
from pathlib import Path
import re
import difflib
import unicodedata

from evaluate import canonical

ROOT = Path(__file__).resolve().parent


def read_gold():
    rows = []
    for line in (ROOT/'camera-ready-structure.tsv').read_text().splitlines():
        if not line.strip() or line.startswith('#'):
            continue
        identifier, kind, owner, page, selector = [s.strip() for s in line.split('|')]
        rows.append(dict(id=identifier, kind=kind, owner=owner, page=int(page), selector=selector))
    return rows


def owner_key(block):
    if not block['section_path']:
        return '@'+block['front_matter_role']
    parts = []
    for title in block['section_path']:
        match = re.match(r'^([IVX]+|[A-Z]|\d+)[.)]\s*', title)
        parts.append(match[1] if match else title.strip().upper())
    return '/'.join(parts)


def audit(structure, gold):
    blocks = structure['blocks']
    failures, matches, used = [], [], set()
    last = -1
    for expected in gold:
        selector = expected['selector']
        if selector.startswith('@caption:'):
            caption_ids = {x['caption_of'] for x in blocks if x['caption_of'] and canonical(x['text']).startswith(canonical(selector.split(':',1)[1]))}
            candidates = [(i,b) for i,b in enumerate(blocks) if b['id'] in caption_ids]
        elif selector.startswith('@marker:'):
            candidates = [(i,b) for i,b in enumerate(blocks) if b['marker']==selector.split(':',1)[1]]
        elif selector.startswith('@equation:'):
            candidates = [(i,b) for i,b in enumerate(blocks) if b.get('source_equation_number')==int(selector.split(':',1)[1])]
        else:
            candidates = [(i,b) for i,b in enumerate(blocks) if canonical(b['text'] or '').startswith(canonical(selector))]
        if len(candidates) != 1:
            failures.append({'id':expected['id'], 'kind':'missing_or_ambiguous', 'matches':len(candidates)})
            continue
        index, actual = candidates[0]
        page = actual['provenance'][0]['page_no'] if actual['provenance'] else None
        discrepancies = {}
        for field, actual_value in [('kind',actual['kind']), ('owner',owner_key(actual)), ('page',page)]:
            if expected[field] != actual_value:
                discrepancies[field] = {'expected':expected[field], 'actual':actual_value}
        if actual['id'] in used:
            discrepancies['duplicate_assignment'] = actual['id']
        if index < last:
            discrepancies['reading_order'] = {'index':index, 'previous_index':last}
        if discrepancies:
            failures.append({'id':expected['id'], 'kind':'mismatch', 'details':discrepancies})
        matches.append({'source_id':expected['id'], 'block_id':actual['id'], 'owner':owner_key(actual),
                        'page':page, 'kind':actual['kind'], 'text':actual['text']})
        used.add(actual['id'])
        last = index
    extras = [b['id'] for b in blocks if b['id'] not in used]
    if extras:
        failures.append({'kind':'unaccounted_output_blocks', 'ids':extras})
    return {'status':'pass' if not failures else 'fail', 'expected_blocks':len(gold),
            'actual_blocks':len(blocks), 'sections':len(structure['sections']),
            'failures':failures, 'matches':matches,
            'limits':'Complete annotated block presence/type/owner/order check for this exact source; not mathematical or character-level fidelity certification.'}


def source_coverage(structure, pdf):
    from docling_core.types.doc import BoundingBox
    locations = {}
    for block in structure['blocks']:
        for p in block['provenance']:
            box = BoundingBox.model_validate(p['bbox']).to_top_left_origin(pdf[p['page_no']-1].rect.height)
            locations.setdefault(p['page_no'], []).append(box)
    pages = []
    for page_no, page in enumerate(pdf,1):
        words = page.get_text('words')
        missing = []
        for w in words:
            x, y = (w[0]+w[2])/2, (w[1]+w[3])/2
            if not any(b.l-2<=x<=b.r+2 and b.t-2<=y<=b.b+2 for b in locations.get(page_no, [])):
                missing.append({'text':w[4], 'bbox':list(w[:4])})
        pages.append({'page':page_no, 'native_words':len(words), 'uncovered_words':missing})
    return {'pages':pages, 'limits':'Geometry coverage only; a covered word can still be transcribed incorrectly. Scanned pages have no native-word ground truth.'}


def text_diagnostics(structure, pdf):
    from docling_core.types.doc import BoundingBox
    findings = []
    for block in structure['blocks']:
        if not block['text'] or block['kind'] in ('formula', 'caption', 'table', 'figure'):
            continue
        source_words = []
        seen = set()
        for prov in block['provenance']:
            page = pdf[prov['page_no']-1]
            b = BoundingBox.model_validate(prov['bbox']).to_top_left_origin(page.rect.height)
            for word in page.get_text('words'):
                key = (prov['page_no'], *word[:4], word[4])
                if key in seen:
                    continue
                if b.l-1 <= (word[0]+word[2])/2 <= b.r+1 and b.t-1 <= (word[1]+word[3])/2 <= b.b+1:
                    source_words.append(word[4]); seen.add(key)
        source_text = ' '.join(source_words)
        marker = block.get('marker')
        if marker and source_text.startswith(marker):
            source_text = source_text[len(marker):].strip()
        # Keep symbols and punctuation: deleting them would hide math losses.
        # Even an exact text match cannot validate superscript/bold positioning.
        compact = lambda value: re.sub(r'\s+', '', unicodedata.normalize('NFKC', value))
        source_key, output_key = compact(source_text), compact(block['text'])
        if source_key and source_key != output_key:
            comparison=difflib.SequenceMatcher(None,source_key,output_key,autojunk=False)
            findings.append({'id':block['id'], 'section':owner_key(block),
                             'source_text_from_geometry':source_text, 'output_text':block['text'],
                             'compact_text_similarity':round(comparison.ratio(),4),
                             'changes':[{'source':source_key[i:j], 'output':output_key[k:l],
                                         'source_context':source_key[max(0,i-15):j+15]}
                                        for tag,i,j,k,l in comparison.get_opcodes() if tag!='equal'],
                             'status':'needs_visual_review'})
    return {'findings':findings, 'limits':'Unverified native-word diagnostic. Source geometry can include neighboring words; whitespace is ignored and Unicode is normalized. Text matches do not validate formatting or characters absent from both native extractors. No automatic replacements or fidelity score.'}


def main():
    import pymupdf
    from docling_core.types.doc import DoclingDocument
    from structure import build_structure

    p = argparse.ArgumentParser()
    p.add_argument('output', type=Path)
    p.add_argument('--source', type=Path, default=ROOT/'inputs/camera-ready.pdf')
    args = p.parse_args()
    expected_hash = re.search(r'^# source_sha256: ([a-f0-9]{64})$',(ROOT/'camera-ready-structure.tsv').read_text(),re.M)[1]
    if hashlib.sha256(args.source.read_bytes()).hexdigest() != expected_hash:
        p.error('This manual audit applies only to the recorded camera-ready PDF')
    out = args.output.resolve()
    run = json.loads((out/'run.json').read_text())
    source_kind = 'exact_source_pdf'
    if run['sha256'] != expected_hash:
        variants=json.loads((ROOT/'inputs/variants.json').read_text())
        variant=next((v for v in variants if v.get('id')==out.name and v.get('derived_from')=='camera-ready'),None)
        recorded=ROOT/'inputs'/f'{out.name}.pdf'
        if not variant or not recorded.exists() or hashlib.sha256(recorded.read_bytes()).hexdigest()!=run['sha256']:
            p.error('Output is neither the recorded source nor its registered synthetic scan/mixed variant')
        source_kind='registered_synthetic_variant_of_source'
    quality = json.loads((out/'quality.json').read_text())
    with pymupdf.open(run['input']) as parsed_pdf:
        # Rebuild from the actual parsed input, including its OCR evidence.
        # The digital original is used only for independent diagnostics below.
        document = DoclingDocument.load_from_json(out/'document.json')
        ocr_lines=json.loads((out/'ocr-lines.json').read_text()) if (out/'ocr-lines.json').exists() else []
        structure = build_structure(document, quality['figure_table_overrides'], quality['fixes'], parsed_pdf, ocr_lines=ocr_lines)
        result = audit(structure, read_gold())
    with pymupdf.open(args.source) as pdf:
        result['source_geometry_coverage'] = source_coverage(structure, pdf)
        diagnostics = text_diagnostics(structure, pdf)
    result['source_sha256'] = expected_hash
    result['parsed_input_sha256'] = run['sha256']
    result['source_kind'] = source_kind
    result['gold_sha256'] = hashlib.sha256((ROOT/'camera-ready-structure.tsv').read_bytes()).hexdigest()
    (out/'structure-audit.json').write_text(json.dumps(result,indent=2,ensure_ascii=False))
    (out/'content-diagnostics.json').write_text(json.dumps(diagnostics,indent=2,ensure_ascii=False))
    lines = ['# Complete structural audit', '',
             f"Status: **{result['status']}** — {result['expected_blocks']} expected content blocks, {result['sections']} detected sections.", '',
             result['limits'], '', '| Source item | Type | Section owner | Page |', '|---|---|---|---:|']
    for row in result['matches']:
        lines.append(f"| {row['source_id']} | {row['kind']} | {row['owner']} | {row['page']} |")
    lines.extend(['', '## Failures', '', '```json', json.dumps(result['failures'],indent=2), '```', '',
                  '## Source geometry coverage', '', 'This tests coverage by source bounds, not text recognition accuracy.'])
    for row in result['source_geometry_coverage']['pages']:
        lines.append(f"- Page {row['page']}: {len(row['uncovered_words'])} of {row['native_words']} native words have centers outside all block bounds.")
    (out/'STRUCTURE_AUDIT.md').write_text('\n'.join(lines)+'\n')
    print(json.dumps({k:result[k] for k in ('status','expected_blocks','actual_blocks','sections','failures')},indent=2))
    if result['failures']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
