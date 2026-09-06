"""Build traceable Markdown and visual review artifacts from an immutable raw run."""
from __future__ import annotations

from collections import Counter
import html
import hashlib
import json
from pathlib import Path
import re
import shutil
import unicodedata

def tokens(text):
    return re.findall(r"\w+", unicodedata.normalize("NFKC", text).casefold())

def prepare_review(source: Path, out: Path):
    import pymupdf
    from docling_core.types.doc import DoclingDocument, ImageRefMode
    from markdown_it import MarkdownIt

    doc = DoclingDocument.load_from_json(out / "raw.json")
    run = json.loads((out / "run.json").read_text())
    assets = out / "assets"
    assets.mkdir(exist_ok=True)
    fixes = []
    warnings = []
    source_pages = []
    pdf = pymupdf.open(source)
    for i, page in enumerate(pdf):
        image_path = assets / f"page-{i+1:02}.png"
        if not image_path.exists():
            page.get_pixmap(matrix=pymupdf.Matrix(1.5,1.5)).save(image_path)
        source_pages.append(page.get_text())

    from normalize import normalize_document
    from ocr_structure import repair_ocr_structure
    ocr_lines=json.loads((out/'ocr-lines.json').read_text()) if (out/'ocr-lines.json').exists() else []
    fixes.extend(repair_ocr_structure(doc,pdf,ocr_lines))
    structural_fixes,structural_warnings=normalize_document(doc,pdf)
    fixes.extend(structural_fixes);warnings.extend(structural_warnings)
    from structure import repair_structure, build_structure
    fixes.extend(repair_structure(doc,pdf))
    from native_text import restore_native_punctuation
    fixes.extend(restore_native_punctuation(doc,pdf))
    from tables import repair_tables
    table_presentations, table_fixes = repair_tables(doc, pdf, out)
    fixes.extend(table_fixes)
    active_headings={x.self_ref for x,_ in doc.iterate_items() if x.label.value=='section_header'}
    warnings=[w for w in warnings if w['kind']!='unnumbered_heading_level_inferred' or w['id'] in active_headings]

    # Baseline stays untouched; export a corrected document independently.
    doc.save_as_markdown(out / "paper.md", image_mode=ImageRefMode.REFERENCED)
    md = (out / "paper.md").read_text()
    md=re.sub(r'(?m)^- (\d+\))',r'\1',md)
    formula_candidates=[]
    figure_tables=[]
    for table in doc.tables:
        captions=[r.resolve(doc).text for r in table.captions]
        if captions and re.match(r"(?i)^fig(?:ure)?\.?\s*\d",captions[0]) and table.prov:
            prov=table.prov[0];page=pdf[prov.page_no-1]
            box=prov.bbox.to_top_left_origin(page.rect.height)
            name=f"figure-from-{table.self_ref.rsplit('/',1)[1]}.png"
            page.get_pixmap(matrix=pymupdf.Matrix(2,2),clip=pymupdf.Rect(box.l,box.t,box.r,box.b)).save(assets/name)
            plain=table.export_to_markdown(doc=doc)
            if plain and plain in md:
                md=md.replace(plain,f"![{html.escape(captions[0])}](assets/{name})\n\n"+'\n\n'.join(captions),1)
                figure_tables.append(table.self_ref)
                fixes.append({"kind":"caption_identified_figure","id":table.self_ref,"caption":captions[0],"asset":f"assets/{name}"})
            continue
        if table.self_ref in table_presentations:
            plain=table.export_to_markdown(doc=doc)
            if plain and plain in md:
                md=md.replace(plain,table_presentations[table.self_ref]['html'],1)
            else:
                warnings.append({'kind':'source_table_export_not_matched','id':table.self_ref})
        elif any(c.row_span > 1 or c.col_span > 1 for c in table.data.table_cells):
            plain = table.export_to_markdown(doc=doc)
            if plain and plain in md:
                md = md.replace(plain, table.export_to_html(doc=doc), 1)
                fixes.append({"kind":"merged_table_html", "id":table.self_ref})
            else:
                warnings.append({"kind":"merged_table_export_not_matched", "id":table.self_ref})
    for item, _ in doc.iterate_items():
        if item.label.value != "formula":
            continue
        if not item.prov:
            warnings.append({"kind":"formula_without_location", "id":item.self_ref})
            continue
        prov = item.prov[0]
        page = pdf[prov.page_no - 1]
        bbox = prov.bbox.to_top_left_origin(page_height=page.rect.height)
        rect = pymupdf.Rect(bbox.l-5, bbox.t-5, bbox.r+3, bbox.b+3) & page.rect
        if rect.is_empty:
            warnings.append({"kind":"formula_invalid_bounds", "id":item.self_ref})
            continue
        name = "formula-" + item.self_ref.replace("#/", "").replace("/", "-") + ".png"
        page.get_pixmap(matrix=pymupdf.Matrix(2,2), clip=rect).save(assets / name)
        # Recognized LaTeX remains unverified, including when enrichment is on.
        # Preserve source pixels in the reader and retain candidates separately.
        warnings.append({"kind":"formula_requires_visual_verification" if run["formulas"] else "formula_source_fallback",
                         "id":item.self_ref, "page":prov.page_no, "asset":f"assets/{name}"})
        text = getattr(item, "text", "")
        formula_candidates.append({"id":item.self_ref,"page":prov.page_no,"latex":text,
                                   "source_image":f"assets/{name}","verified":False})
        for candidate in (f"$$\n{text}\n$$", f"$${text}$$", "<!-- formula-not-decoded -->"):
            if candidate in md:
                md = md.replace(candidate, f"![Original equation, page {prov.page_no}](assets/{name})", 1)
                fixes.append({"kind":"formula_crop", "id":item.self_ref})
                break
        else:
            warnings.append({"kind":"formula_export_not_matched","id":item.self_ref})
    # Portable bundles: Docling's referenced exporter currently writes absolute paths.
    md=re.sub(r"\]\((/[^)]+)\)",lambda m:
        "]("+str(Path(m[1]).relative_to(out))+")" if Path(m[1]).is_relative_to(out) else m[0],md)
    # Match adjacent caption/image pairs only; preserve source caption placement.
    for picture in doc.pictures:
        if not picture.prov or len(picture.captions)!=1:continue
        caption=picture.captions[0].resolve(doc)
        if not caption.prov or caption.prov[0].page_no!=picture.prov[0].page_no:continue
        height=pdf[picture.prov[0].page_no-1].rect.height
        pb=picture.prov[0].bbox.to_top_left_origin(height)
        cb=caption.prov[0].bbox.to_top_left_origin(height)
        if cb.t<pb.b-2:continue
        escaped=html.escape(caption.text,quote=False)
        pattern=re.escape(escaped)+r'\s*\n\n(!\[Image\]\([^\n]+\))'
        md,count=re.subn(pattern,lambda m:m[1]+'\n\n'+escaped,md,count=1)
        if count:fixes.append({'kind':'caption_follows_source_figure','id':picture.self_ref})
    from inline import enrich_inline
    md, inline_content, inline_fixes = enrich_inline(doc, pdf, out, md)
    fixes.extend(inline_fixes)
    from source_fragments import preserve_scanned_paragraphs
    md, source_fragments = preserve_scanned_paragraphs(doc,pdf,out,md)
    warnings.extend(source_fragments['warnings'])
    (out / "paper.md").write_text(md)
    (out / "formula-candidates.json").write_text(json.dumps(formula_candidates,indent=2,ensure_ascii=False))
    doc.save_as_json(out / "document.json", image_mode=ImageRefMode.REFERENCED)
    structure=build_structure(doc,figure_tables,fixes,pdf,ocr_lines)
    inline_ids = {b['id'] for b in inline_content['blocks']}
    source_ids = {b['id'] for b in source_fragments['blocks']}
    for block in structure['blocks']:
        if block['id'] in inline_ids:
            block['inline_content'] = {'file':'inline-content.json', 'block_id':block['id']}
        if block['id'] in table_presentations:
            block['table_content'] = {'file':'table-content.json','table_id':block['id']}
        if block['id'] in source_ids:
            block['source_fragments'] = {'file':'source-fragments.json','block_id':block['id']}
    (out/'structure.json').write_text(json.dumps(structure,indent=2,ensure_ascii=False))

    extracted = "\n".join(getattr(item, "text", "") for item, _ in doc.iterate_items())
    for table in doc.tables:
        extracted += "\n" + " ".join(c.text for c in table.data.table_cells)
    original_counts, output_counts = Counter(tokens("\n".join(source_pages))), Counter(tokens(extracted))
    matched = sum((original_counts & output_counts).values())
    recall = matched / max(1,sum(original_counts.values()))
    headings = [{"id":item.self_ref,"level":item.level,"text":item.text,
                 "page":item.prov[0].page_no if item.prov else None}
                for item, _ in doc.iterate_items() if item.label.value == "section_header"]
    for item in doc.texts:
        if item.label.value=="caption" and (m:=re.search(r"(?i)\bfig(?:ure)?\.?\s*\d+",item.text)) and m.start()>0:
            warnings.append({"kind":"caption_contains_preceding_plot_labels","id":item.self_ref,"text":item.text})
    missing = original_counts - output_counts
    quality = {"approval":"needs_review", "headings":headings, "warnings":warnings, "fixes":fixes,
               "normalization_files_sha256":{name:hashlib.sha256((Path(__file__).parent/name).read_bytes()).hexdigest() for name in ('normalize.py','structure.py','review.py','inline.py','glyphs.py','tables.py','source_fragments.py','ocr_structure.py','native_text.py')},
               "source_paragraph_fallbacks":len(source_fragments['blocks']),
               "inline_presentation":{"blocks":len(inline_content['blocks']),"source_crops":sum(len(b['source_crops']) for b in inline_content['blocks']),"skipped":dict(Counter(b['reason'] for b in inline_content['skipped']))},
               "effective_counts":{**dict(Counter(x.label.value for x,_ in doc.iterate_items())),"picture":len(doc.pictures)+len(figure_tables),"table":len(doc.tables)-len(figure_tables)},
               "figure_table_overrides":figure_tables,
               "figure_caption_numbers":sorted({int(m[1]) for item in doc.texts if item.label.value=="caption" and (m:=re.search(r"(?i)\bfig(?:ure)?\.?\s*(\d+)",item.text))}),
               "native_text_token_recall":round(recall,4) if original_counts else None,
               "missing_tokens_sample":missing.most_common(35),
               "metric_limits":"Bag-of-words diagnostic only. Not reading-order, hierarchy, semantic, or OCR accuracy. Headers and figure labels may differ. Image-only PDFs have no native-text ground truth."}
    (out / "quality.json").write_text(json.dumps(quality, indent=2, ensure_ascii=False))
    renderer = MarkdownIt("commonmark", {"html":True}).enable("table")
    from evaluate import canonical
    heading_ids={canonical(s['title']):'section-'+s['id'].replace('#/','').replace('/','-') for s in structure['sections']}
    render_tokens=renderer.parse(md)
    for i,token in enumerate(render_tokens[:-1]):
        if token.type=='heading_open':
            identifier=heading_ids.get(canonical(html.unescape(render_tokens[i+1].content)))
            if identifier:token.attrSet('id',identifier)
    body = renderer.renderer.render(render_tokens,renderer.options,{})
    outline=''.join(f'<li style="margin-left:{(s["level"]-1)*16}px"><a href="#{heading_ids[canonical(s["title"])]}">{html.escape(s["title"])}</a></li>' for s in structure['sections'])
    root = Path(__file__).resolve().parents[1]
    katex = root / "node_modules/katex/dist"
    if katex.exists() and not (assets / "katex").exists():
        shutil.copytree(katex, assets / "katex")
    page_links = "".join(f'<a href="#source-{i+1}">Page {i+1}</a> ' for i in range(len(pdf)))
    page_html = "".join(f'<section id="source-{i+1}"><h3>Original page {i+1}</h3><img loading="lazy" src="assets/page-{i+1:02}.png"></section>' for i in range(len(pdf)))
    shell = '''<!doctype html><html><meta charset="utf-8"><title>PDF / Markdown fidelity review</title>
<link rel="stylesheet" href="assets/katex/katex.min.css">
<style>body{margin:0;font:16px/1.6 system-ui;background:#eee;height:100vh;display:flex;flex-direction:column}header{padding:12px;background:#18273c;color:white;max-height:35vh;overflow:auto;flex-shrink:0}header a{color:#bde}header ul{list-style:none;padding:0}main{display:grid;grid-template-columns:1fr 1fr;flex:1;min-height:0}article,aside{overflow:auto;padding:24px;background:white;border:1px solid #ddd}img{max-width:100%}table{border-collapse:collapse;display:block;overflow:auto}td,th{border:1px solid #ccc;padding:6px}pre{white-space:pre-wrap}h1,h2,h3{line-height:1.3}blockquote{border-left:4px solid #c90;padding-left:12px}</style>
<header><b>__TITLE__</b> — source PDF / exported paper.md<br>Review required: compare hierarchy, order, equations, tables and captions. __LINKS__<details><summary>Section outline</summary><ul>__OUTLINE__</ul></details></header>
<main><aside>__PAGES__</aside><article id="markdown">__BODY__</article></main>
<script src="assets/katex/katex.min.js"></script><script src="assets/katex/contrib/auto-render.min.js"></script>
<script>if(window.renderMathInElement)renderMathInElement(document.getElementById('markdown'),{delimiters:[{left:'$$',right:'$$',display:true},{left:'\\\\(',right:'\\\\)',display:false}],throwOnError:false,trust:false});</script></html>'''
    (out / "review.html").write_text(shell.replace("__TITLE__",html.escape(source.name)).replace("__LINKS__",page_links).replace("__PAGES__",page_html).replace("__BODY__",body).replace('__OUTLINE__',outline))
    pdf.close()

if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("output", type=Path)
    a = p.parse_args()
    run = json.loads((a.output / "run.json").read_text())
    prepare_review(Path(run["input"]), a.output)
