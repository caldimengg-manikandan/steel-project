"""
Debug script to diagnose title extraction for specific PDFs.
Run from backend/: python test_title_debug.py
"""
import os, sys, re, glob

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pdfplumber # type: ignore

from src.scripts.extract_drawing import (  # type: ignore
    score_title,
    strip_all_dates,
    KEYWORDS,
)

def debug_pdf(pdf_path):
    print(f"\n{'='*60}")
    print(f"FILE: {os.path.basename(pdf_path)}")
    print('='*60)

    with pdfplumber.open(pdf_path) as pdf:
        page = pdf.pages[0]
        text = page.extract_text(layout=True, x_tolerance=2.0) or ""

    print("\n--- RAW TEXT (first 80 lines) ---")
    lines = text.splitlines()
    for i, line in enumerate(lines[:80]):
        print(f"{i+1:3}: {repr(line)}")

    print("\n--- KEYWORD HITS ---")
    found_kw = [kw for kw in KEYWORDS if re.search(rf'\b{kw}\b', text, re.I)]
    print("  " + (", ".join(found_kw) if found_kw else "NONE"))

    print("\n--- DESCRIPTION LINES ---")
    for i, line in enumerate(lines):
        if re.search(r'DESCRIPTION', line, re.I):
            print(f"  line {i+1}: {repr(line)}")

    print("\n--- CANDIDATE SCORING ---")
    candidates = []

    m1 = re.search(r'Drawing\s*Title\s*[:.]\s*(\S[^\n]*)', text, re.I)
    if m1: candidates.append(("Pass A - Drawing Title", m1.group(1).strip()))

    m2 = re.search(r'DWG\s+DESCRIPTION\s*[:.\-\s]*\n?\s*([A-Z0-9\s,&/\-]+?)(?=\s\s+|\n|[A-Z]{3,}:|$)', text, re.I)
    if m2: candidates.append(("Pass A - DWG DESC", m2.group(1).strip()))

    for i, line in enumerate(lines):
        is_dwg_desc = re.search(r'\bDWG\s+DESCRIPTION\s*[:.\s]+', line, re.I)
        is_just_desc = re.search(r'\bDESCRIPTION\s*[:.\s]+', line, re.I) and not re.search(r'PROJECT', line, re.I)
        if is_dwg_desc or is_just_desc:
            m = re.search(r'DESCRIPTION\s*[:.\s]+(.*?)(?=\s\s+|\n|[A-Z]{3,}:|$)', line, re.I)
            if m: candidates.append((f"Pass B line {i+1}", m.group(1).strip()))

    for line in reversed(lines):
        if re.search(r'DWG\s+DESCRIPTION', line, re.I):
            m = re.search(r'DWG\s+DESCRIPTION\s*[:.\s]+\s*(.+)', line, re.I)
            if m: candidates.append(("Pass C reversed", m.group(1).strip()))

    for kw in KEYWORDS:
        if re.search(rf'^\s*{kw}\s*$', text, re.M | re.I):
            candidates.append((f"Pass D exact", kw))
        if re.search(rf'\b{kw}\s+DETAIL\b', text, re.I):
            candidates.append((f"Pass D +DETAIL", f"{kw} DETAIL"))

    print(f"\n  {'SOURCE':<35} {'CLEANED CANDIDATE':<45} SCORE")
    print(f"  {'-'*35} {'-'*45} -----")
    best_score = -1
    best_title = ""
    for src, cand in candidates:
        cleaned = strip_all_dates(re.sub(r'^(?:DWG\s+)?DESCRIPTION\s*[:.\s]+', '', cand, flags=re.I).strip())
        s = score_title(cleaned)
        flag = ""
        if s > best_score:
            best_score = s
            best_title = cleaned
            flag = " ← WIN"
        print(f"  {src:<35} {cleaned[:45]:<45} {s}{flag}")

    print(f"\n  >> FINAL TITLE: {best_title!r}  (score={best_score})")


if __name__ == "__main__":
    if len(sys.argv) >= 2:
        debug_pdf(sys.argv[1])
    else:
        pdfs = glob.glob(r'c:\Users\Arshad Ibrahim\steel-project\backend\uploads\drawings\**\*.pdf', recursive=True)
        if not pdfs:
            print("No PDFs found in uploads. Pass a PDF path as argument.")
            sys.exit(1)
        pdfs.sort(key=os.path.getmtime, reverse=True)
        for pdf in pdfs[:3]:
            debug_pdf(pdf)
