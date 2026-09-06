"""Local app entrypoint: preflight or serialize model inference across processes."""
import argparse
import fcntl
import json
from pathlib import Path
import sys

from parse_pdf import inspect_pdf

p=argparse.ArgumentParser();p.add_argument('pdf',type=Path);p.add_argument('--output',type=Path);p.add_argument('--validate',action='store_true')
a=p.parse_args()
try:
    info=inspect_pdf(a.pdf)
except ValueError as error:
    print(json.dumps({'error':str(error)}));raise SystemExit(2)
if a.validate:
    print(json.dumps({'pages':info['pages']}));raise SystemExit(0)
if a.output is None:p.error('--output is required')
lock=Path(__file__).resolve().parents[1]/'tmp/docling-parser.lock';lock.parent.mkdir(exist_ok=True)
with lock.open('a') as handle:
    fcntl.flock(handle,fcntl.LOCK_EX)
    from parse_pdf import main
    sys.argv=[sys.argv[0],str(a.pdf),'--output',str(a.output),'--threads','2']
    main()
    from app_export import export_app
    export_app(a.output)
