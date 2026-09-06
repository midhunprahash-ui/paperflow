"""Independent source-reviewed inline checks, separate from extraction code."""
from __future__ import annotations
from html.parser import HTMLParser
import argparse
import hashlib
import json
from pathlib import Path
import re
import unicodedata

ROOT = Path(__file__).resolve().parent


def compact(text):
    return re.sub(r'\s+', '', unicodedata.normalize('NFKC', text))


class InlineHTML(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.stack = []; self.text = []; self.images = []
        self.styled = {'sub':[], 'sup':[], 'bold':[], 'italic':[], 'bold_italic':[]}
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        if tag == 'img':
            attrs = dict(attrs); self.images.append(attrs)
            self.text.append(attrs.get('alt', '').removeprefix('Original inline expression; unverified text: '))
        else:
            self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag in self.stack:
            self.stack = self.stack[:len(self.stack)-1-self.stack[::-1].index(tag)]

    def handle_data(self, data):
        self.text.append(data)
        for key, required in [('sub', ['sub']), ('sup', ['sup']), ('bold', ['strong']),
                              ('italic', ['em']), ('bold_italic', ['strong', 'em'])]:
            if all(tag in self.stack for tag in required) and data.strip():
                self.styled[key].append(data.strip())


def check_gold(manifest, gold, md, out):
    failures = []
    if manifest['source_sha256'] != gold['source_sha256']:
        failures.append('Wrong source PDF for this manual gold')
    matched = []
    for expected in gold['blocks']:
        candidates = [b for b in manifest['blocks'] if compact(b['original_text']).startswith(compact(expected['selector']))]
        name = expected['selector']
        if len(candidates) != 1:
            failures.append(f'{name}: expected one rendered block, found {len(candidates)}'); continue
        block = candidates[0]; parsed = InlineHTML(block['html']); matched.append(block['id'])
        if block['page'] != expected['page']:
            failures.append(f'{name}: wrong source page')
        if md.count(block['html']) != 1:
            failures.append(f'{name}: rendered block missing or duplicated in Markdown')
        if compact(''.join(parsed.text)) != compact(block['original_text']):
            failures.append(f'{name}: rendered characters differ from extracted text')
        if parsed.styled['sub'] != expected['sub']:
            failures.append(f'{name}: expected subscripts {expected["sub"]}, got {parsed.styled["sub"]}')
        for style in ('italic', 'bold', 'bold_italic'):
            for phrase in expected.get(style, []):
                if phrase not in parsed.styled[style]:
                    failures.append(f'{name}: missing {style} phrase {phrase}')
        if len(block['source_crops']) != len(expected['crops']) or len(parsed.images) != len(expected['crops']):
            failures.append(f'{name}: wrong crop count'); continue
        for crop, image, target in zip(block['source_crops'], parsed.images, expected['crops']):
            if target['reason'] not in crop['reasons'] or compact(target['text']) != compact(crop['text_alternative']):
                failures.append(f'{name}: wrong expression or fallback reason')
            if len(crop['drawing_bounds']) != target['drawings']:
                failures.append(f'{name}: missing drawn marks')
            if crop['asset'] != image['src'] or not (out/crop['asset']).is_file():
                failures.append(f'{name}: missing or mismatched crop asset')
            runs = block['lines'][crop['line']]['runs'][crop['run_start']:crop['run_end']]
            for text in target.get('native_sup', []):
                if not any(r['script']=='sup' and r['text'].strip()==text for r in runs):
                    failures.append(f'{name}: missing superscript evidence for {text}')
    return dict(status='fail' if failures else 'pass', checked_prose_blocks=len(gold['blocks']),
                matched_blocks=matched, failures=failures,
                limits='Source-specific presentation checks, including recorded crop alternatives. Not universal math recognition, accessible semantic math, or OCR certification.')


def main():
    p = argparse.ArgumentParser(); p.add_argument('output', type=Path); a = p.parse_args()
    out = a.output.resolve()
    gold_path = ROOT/'camera-ready-inline.json'
    manifest = json.loads((out/'inline-content.json').read_text())
    result = check_gold(manifest, json.loads(gold_path.read_text()), (out/'paper.md').read_text(), out)
    result['gold_sha256'] = hashlib.sha256(gold_path.read_bytes()).hexdigest()
    result['source_sha256'] = manifest['source_sha256']
    (out/'inline-audit.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
    if result['failures']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
