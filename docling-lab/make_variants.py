"""Generate clearly labelled OCR and structural stress cases; never alter originals."""
import json
from pathlib import Path
import pymupdf

ROOT = Path(__file__).resolve().parent

def image_copy(source, destination, mixed=False, dpi=180):
    with pymupdf.open(source) as src, pymupdf.open() as dst:
        for i, page in enumerate(src):
            if mixed and i % 2 == 0:
                dst.insert_pdf(src, from_page=i,to_page=i)
            else:
                pix = page.get_pixmap(matrix=pymupdf.Matrix(dpi/72,dpi/72), colorspace=pymupdf.csGRAY)
                p = dst.new_page(width=page.rect.width,height=page.rect.height)
                p.insert_image(p.rect,stream=pix.tobytes("png"))
        dst.save(destination, deflate=True)

def main():
    folder=ROOT / "inputs"
    variants=[]
    for source, name, mixed, dpi in [
        ("camera-ready","camera-ready-scan",False,180),
        ("camera-ready","camera-ready-mixed",True,180),
        ("scikit-learn","scikit-learn-scan",False,120),
    ]:
        target=folder/f"{name}.pdf"
        if not target.exists():
            image_copy(folder/f"{source}.pdf",target,mixed,dpi)
        variants.append({"id":name,"derived_from":source,"kind":"synthetic scan, not a physical scan","dpi":dpi,"mixed":mixed})
    # A controlled hierarchy/list/cell fixture complements real papers; it is not called research.
    target=folder/"structure-fixture.pdf"
    if not target.exists():
        with pymupdf.open() as pdf:
            page=pdf.new_page()
            for x,y,size,text in [
                (50,50,20,"Structure Preservation Fixture"),(50,95,16,"1. Introduction"),
                (50,120,11,"The original section contains this exact sentence."),
                (50,160,14,"1.1 Method"),(50,185,11,"The method paragraph must remain under Method."),
                (50,220,12,"1.1.1 Parameters"),(50,245,11,"- First item"),(70,265,11,"- Nested item"),
                (50,300,14,"1.2 Results"),(50,325,11,"Table 1. Merged table with source values."),
                (50,470,16,"2. Conclusion"),(50,495,11,"Final content belongs to Conclusion."),
            ]:
                page.insert_text((x,y),text,fontsize=size)
            for y in (345,375,405,435):page.draw_line((50,y),(350,y))
            for x in (50,150,350):page.draw_line((x,345),(x,435))
            page.draw_line((250,375),(250,435))
            for x,y,text in [(55,365,"Model"),(155,365,"Measurements"),(55,395,"Metric"),(155,395,"Precision"),(255,395,"Recall"),(55,425,"Baseline"),(155,425,"0.91"),(255,425,"0.87")]:
                page.insert_text((x,y),text,fontsize=10)
            pdf.set_toc([[1,"1. Introduction",1],[2,"1.1 Method",1],[3,"1.1.1 Parameters",1],[2,"1.2 Results",1],[1,"2. Conclusion",1]])
            pdf.save(target)
    variants.append({"id":"structure-fixture","kind":"synthetic controlled fixture","expected_headings":[[1,"1. Introduction"],[2,"1.1 Method"],[3,"1.1.1 Parameters"],[2,"1.2 Results"],[1,"2. Conclusion"]]})
    (folder/"variants.json").write_text(json.dumps(variants,indent=2)+"\n")
    print(json.dumps(variants,indent=2))

if __name__ == "__main__":main()
