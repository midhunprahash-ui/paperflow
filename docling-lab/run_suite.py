"""Run isolated, sequential conversions; preserve failures and report measured usage."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parent

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--run",default="baseline")
    p.add_argument("--cases",nargs="*")
    p.add_argument("--formulas",action="store_true")
    p.add_argument("--timeout",type=int,default=1800)
    a=p.parse_args()
    if not a.run or Path(a.run).name != a.run:
        p.error("--run must be a folder name")
    if a.timeout<1:p.error('--timeout must be positive')
    files=sorted((ROOT/"inputs").glob("*.pdf"))
    unknown=set(a.cases or [])-{f.stem for f in files}
    if unknown:p.error('Unknown cases: '+', '.join(sorted(unknown)))
    if a.cases:files=[f for f in files if f.stem in a.cases]
    if not files:p.error("No matching PDFs")
    logs=ROOT/"logs"/a.run;logs.mkdir(parents=True,exist_ok=True)
    prior={r['case']:r for r in json.loads((logs/'suite.json').read_text())} if (logs/'suite.json').exists() else {}
    results=[]
    for pdf in files:
        out=ROOT/"outputs"/a.run/pdf.stem
        if (out/"quality.json").exists():
            run=json.loads((out/'run.json').read_text()) if (out/'run.json').exists() else {}
            saved=prior.get(pdf.stem,{"case":pdf.stem,"state":"existing","output":str(out)})
            if run.get('state')!='converted' or run.get('conversion_issues'):
                saved={**saved,'state':'failed'}
            results.append(saved)
            continue
        print(f"START {pdf.stem}",flush=True)
        command=[sys.executable,str(ROOT/"parse_pdf.py"),str(pdf),"--output",str(out)]
        if a.formulas:command.append("--formulas")
        started=time.monotonic()
        try:
            with (logs/f"{pdf.stem}.log").open("w") as log:
                completed=subprocess.run(command,stdout=log,stderr=subprocess.STDOUT,timeout=a.timeout)
            state="converted" if completed.returncode==0 else "failed"
        except subprocess.TimeoutExpired:
            state="timeout"
        record={"case":pdf.stem,"state":state,"wall_seconds":round(time.monotonic()-started,2),"output":str(out)}
        results.append(record)
        (logs/"suite.json").write_text(json.dumps(results,indent=2))
        print(json.dumps(record),flush=True)
    (logs/"suite.json").write_text(json.dumps(results,indent=2))
    if any(r["state"] in ("failed","timeout") for r in results):sys.exit(1)

if __name__=="__main__":main()
