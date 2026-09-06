"""Compare selected, source-reviewed anchors; this is not a universal fidelity score."""
import argparse
import json
from pathlib import Path
import re
import unicodedata
from collections import Counter

from review import tokens

ROOT=Path(__file__).resolve().parent

def canonical(text):
    return re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFKC",text).casefold())

def compare(expected,quality,run):
    failures=[]; matches=[]; last=-1
    for level,title in expected["headings"]:
        candidates=[(i,h) for i,h in enumerate(quality["headings"]) if canonical(title) in canonical(h["text"])]
        # Prefer the shortest containing title so 'Results' doesn't match 'Experiments and Results'.
        candidates.sort(key=lambda pair:(not bool(re.match(r"^(?:\d|[A-Z][. ]|[IVX]+\.)",pair[1]["text"])),len(pair[1]["text"])))
        if not candidates:
            failures.append({"kind":"missing_heading","expected":title});continue
        i,h=candidates[0]
        matches.append({"expected":title,"actual":h["text"],"level":h["level"]})
        if h["level"]!=level:
            failures.append({"kind":"heading_level","expected":title,"expected_level":level,"actual_level":h["level"]})
        if i<last:failures.append({"kind":"heading_order","expected":title})
        last=i
    for gold,kind in [("figures","picture"),("tables","table")]:
        counts=quality.get("effective_counts",run["counts"])
        actual=len(quality["figure_caption_numbers"]) if gold=="figures" and "figure_caption_numbers" in quality else counts.get(kind,0)
        if gold in expected and actual!=expected[gold]:
            failures.append({"kind":f"{gold}_count","expected":expected[gold],"actual":actual})
    if expected["pages"]!=run["pages"]:failures.append({"kind":"page_count"})
    missing_pages=set(range(1,expected["pages"]+1))-set(run.get("pages_with_blocks",[]))
    if "pages_with_blocks" in run and missing_pages:
        failures.append({"kind":"pages_without_content","pages":sorted(missing_pages)})
    return {"failures":failures,"matched_heading_anchors":matches,"note":"Selected manually reviewed anchors, not exhaustive semantic validation. Figure counts can vary when a composite figure is split."}

def main():
    p=argparse.ArgumentParser();p.add_argument("run");a=p.parse_args()
    gold=json.loads((ROOT/"expectations.json").read_text());reports={}
    for out in sorted((ROOT/"outputs"/a.run).iterdir()):
        if not (out/"quality.json").exists():continue
        name=out.name.removesuffix("-scan").removesuffix("-mixed")
        if name not in gold:continue
        result=compare(gold[name],json.loads((out/"quality.json").read_text()),json.loads((out/"run.json").read_text()))
        if name != out.name:
            import pymupdf
            with pymupdf.open(ROOT/"inputs"/(name+".pdf")) as source:
                original=Counter(tokens("\n".join(p.get_text() for p in source)))
            raw=json.loads((out/"raw.json").read_text())
            extracted=Counter(tokens(" ".join(t.get("text","") for t in raw["texts"])))
            for table in raw["tables"]:
                extracted.update(tokens(" ".join(c.get("text","") for c in table["data"]["table_cells"])))
            result["digital_original_token_recall"]=round(sum((original & extracted).values())/max(1,sum(original.values())),4)
        (out/"evaluation.json").write_text(json.dumps(result,indent=2))
        reports[out.name]=result
        print(out.name,len(result["failures"]),"anchor failures")
    (ROOT/"outputs"/a.run/"evaluation.json").write_text(json.dumps(reports,indent=2))

if __name__=="__main__":main()
