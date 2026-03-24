import os, sys, re, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from src.scripts.extract_drawing import extract_locally  # type: ignore

pdfs = sorted(glob.glob(r'uploads/drawings/**/*.pdf', recursive=True), key=os.path.getmtime, reverse=True)
for p in pdfs[:5]:
    try:
        r = extract_locally(p)
        print(f"{os.path.basename(p)}")
        print(f"   title       = {r.get('drawingTitle')!r}")
        print(f"   projectName = {r.get('projectName')!r}")
    except Exception as e:
        print(f"{os.path.basename(p)}: ERROR {e}")
