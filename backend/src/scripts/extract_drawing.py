import sys
import os
import json
import argparse
import re
import traceback
from typing import Optional, Dict, Any, List, cast

# --- Dependency handling ---
try:
    from pydantic import BaseModel, Field # type: ignore
except ImportError:
    from typing import Any
    def Field(default=None, **kwargs) -> Any: return default
    class BaseModel:
        def __init__(self, **kwargs: Any):
            for k, v in kwargs.items(): setattr(self, k, v)
        @classmethod
        def parse_obj(cls, obj: dict) -> Any: return cls(**obj)

try:
    import pdfplumber # type: ignore
except ImportError:
    pdfplumber = None

try:
    import pytesseract # type: ignore
    from pdf2image import convert_from_path # type: ignore
except ImportError:
    pytesseract = None
    convert_from_path = None


# ── Pydantic schemas ───────────────────────────────────────
class RevisionEntry(BaseModel):
    mark:    str = Field("", description="Revision mark (e.g. '0', 'A', 'B')")
    date:    str = Field("", description="Date in the revision table column")
    remarks: str = Field("", description="Description or Remarks column text")


class DrawingFields(BaseModel):
    drawingNumber:      str = Field("", description="The Sheet Number or Drawing Number.")
    drawingTitle:       str = Field("", description="The Drawing Title.")
    description:        str = Field("", description="General description of the drawing context.")
    drawingDescription: str = Field("", description="Full content of the DWG DESCRIPTION field.")
    revision:           str = Field("", description="The latest Revision Mark only.")
    date:               str = Field("", description="The latest Date from the revision history table.")
    scale:              str = Field("", description="Drawing scale e.g. 1:100")
    clientName:         str = Field("", description="Client name from title block")
    projectName:        str = Field("", description="Project name from title block")
    remarks:            str = Field("", description="The remarks/description for the latest revision entry.")
    revisionHistory:    List[RevisionEntry] = Field(default_factory=list)


# ── Constants & Helpers ─────────────────────────────────────
BODY_NOTE_PATTERN = re.compile(
    r'^\s*(?:PAINT|PREPARATION|SSPC|FINISH|GALV|COATING|PRIMER|NOTES?|SPECIFICATIONS?|FABRICATION|ERECTION|WELDING|GENERAL)\b',
    re.I
)
HARD_STOP_PATTERN = re.compile(
    r'^\s*(?:Scale|Ref(?:erence)?|Contract\s*#|Drawing\s*#|Approved|Contractor|Date|Rev|Weight|Material|Project|Client)\b',
    re.I
)
KEYWORDS = [
    "HORIZONTAL BRACE", "VERTICAL BRACE", "BEAM DETAIL", "FRAME DETAIL",
    "PLATE", "ANGLE", "BEAM", "COLUMN", "CHANNEL", "HSS", "LINTEL", "CLIP",
    "STIFFENER", "BASE PLATE", "CAP PLATE", "BENT PLATE", "WELDMENT", "FRAME",
    "DETAIL", "RAILING", "STAIR", "HANDRAIL", "HANDRAIL DETAIL", "KICKPLATE",
    "GUARDRAIL", "GUARDRAIL DETAIL", "LADDER", "BRACING", "GIRT", "PURLIN",
    "MISCELLANEOUS", "EMBED PLATE", "STEEL"
]
BAD_TITLES = {"MARK", "QTY", "FT IN", "WEIGHT", "MATERIAL", "DATE", "REV", "CHECKED", "DRAWN", "PROJ", "CONTRACTOR", "PROJECT", "OWNER", "DESCRIPTION", "CLIENT"}


def get_bottom_right_region(page):
    """Returns the coordinates for the bottom-right half/corner of the page."""
    width = float(page.width)
    height = float(page.height)
    return (width * 0.5, height * 0.4, width, height)


def safe_get(lst: Any, idx: Any, default: Any = "") -> Any:
    try:
        if lst is not None and idx is not None:
            idx_int = int(idx)
            if idx_int >= 0 and len(list(lst)) > idx_int:
                return list(lst)[idx_int]
    except Exception: pass
    return default


def normalize_date_string(date_str):
    if not date_str: return ""
    m_ext = re.search(r'(\d{1,2}\s*[-/\.]\s*\d{1,2}\s*[-/\.]\s*(?:20\d{2}|19\d{2}|\d{2})|'
                      r'(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,]+\d{1,2}[\s,]+\d{4})', date_str, re.I)
    if m_ext: date_str = m_ext.group(1)
    ds = date_str.strip().replace("/", "-").replace(".", "-")
    ds = re.sub(r'\s+', ' ', ds)

    m1 = re.search(r'([A-Z]{3,})\s+(\d{1,2})[\s,]+(\d{4})', ds, re.I)
    if not m1:
        m1 = re.search(r'(\d{1,2})\s+([A-Z]{3,})[\s,]+(\d{4})', ds, re.I)
        if m1: day_val, month_val, year_val = m1.group(1), m1.group(2), m1.group(3)
        else: day_val, month_val, year_val = None, None, None
    else: month_val, day_val, year_val = m1.group(1), m1.group(2), m1.group(3)

    if month_val and day_val and year_val:
        months = {'JAN':'01','FEB':'02','MAR':'03','APR':'04','MAY':'05','JUN':'06',
                  'JUL':'07','AUG':'08','SEP':'09','OCT':'10','NOV':'11','DEC':'12'}
        ma = str(month_val).upper()[:3]
        if ma in months:
            try: return f"{int(day_val):02d}-{months[ma]}-{year_val}"
            except: pass
    return ds.replace(" ", "")


def is_date_pattern(s):
    if not s: return False
    return bool(re.search(r'\d{1,2}\s*[-/\.]\s*\d{1,2}\s*[-/\.]\s*(?:20\d{2}|19\d{2}|\d{2})|'
                          r'(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,]+\d{1,2}[\s,]+\d{4}', s, re.I))


def strip_all_dates(s: str) -> str:
    if not s: return ""
    numeric_date = r'\b(?:\d{1,4}\s*[-/\.]\s*\d{1,2}\s*[-/\.]\s*(?:20\d{2}|19\d{2}|\d{2}))\b'
    year_first = r'\b(?:(?:20\d{2}|19\d{2})\s*[-/\.]\s*\d{1,2}\s*[-/\.]\s*\d{1,2})\b'
    alpha_date = r'\b(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,]+\d{1,2}[\s,]+\d{4})\b'
    for pat in [numeric_date, year_first, alpha_date]:
        s = re.sub(pat, ' ', s, flags=re.I)
    s = re.sub(r'^\s*[\d\s\-/]{6,}\b', ' ', s) 
    s = re.sub(r'\b[\d\s\-/]{6,}\s*$', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def fix_doubled(m):
    s = m.group(0)
    return "".join(s[i] for i in range(0, len(s), 2))


def clean_rem(s):
    if not s: return ""
    s = re.sub(r'^[xXv\*\-\.\s]+(?=[A-Z0-9])', '', s).strip()
    rev_phrase_match = re.search(r'\b(ISSUED\s+FOR\s+(?:APPROVAL|FABRICATION|CONSTRUCTION|INFORMATION|BID|TENDER)|'
                                  r'FOR\s+(?:APPROVAL|FABRICATION|CONSTRUCTION|INFORMATION)|APPROVED\b|PRELIMINARY\b|FINAL\b)', s, re.I)
    if rev_phrase_match and rev_phrase_match.start() > 0:
        prefix = s[:int(rev_phrase_match.start())].strip()
        if re.search(r'\b\d+\.\s+[A-Z]', prefix, re.I) or re.search(r'\bU\.N\.O\b', prefix, re.I):
            s = s[int(rev_phrase_match.start()):].strip()
    patterns = [r'PROJ[.\s]*NO', r'DRAWN\s+BY', r'PROJ', r'DATE', r'CONTRACTOR', r'REV\b', r'MK\b']
    regex = r'\s+(?:' + '|'.join(patterns) + r')\b'
    parts = re.split(regex, s, flags=re.I)
    return re.sub(r'\s+', ' ', parts[0].strip()).strip(" :.-")


def is_valid_title_candidate(s: str) -> bool:
    if not s or len(s.strip()) < 3: return False
    if re.match(r'^[\d\s\-\./\#]+$', s): return False
    s_up = s.upper().strip()
    if BODY_NOTE_PATTERN.match(s_up) or any(bad in s_up for bad in BAD_TITLES): return False
    if s_up in ("FOR FABRICATION", "FOR APPROVAL", "FOR CONSTRUCTION"): return False
    return True


def score_title(s: str) -> int:
    if not is_valid_title_candidate(s): return -1
    s_up = s.upper().strip()
    score = 100
    keyword_matches = [k for k in KEYWORDS if k in s_up]
    if keyword_matches:
        score += 1000 + len(keyword_matches) * 50
        if any(s_up.startswith(k) for k in keyword_matches): score += 200
    if "DETAIL" in s_up: score += 300
    score -= len(s) * 3
    if re.search(r'\b[A-Z]?\d+[-.]\d+\b', s_up): score -= 500
    return max(0, score)


def get_date_val(r):
    d = str(r.get("date", ""))
    m = re.search(r'(\d+)[-/](\d+)[-/](\d+)', d)
    if not m: return "00000000"
    try:
        p1, p2, p3 = int(m.group(1)), int(m.group(2)), int(m.group(3))
        y = p1 if p1 > 1900 else (p3 if p3 > 1900 else p3 + 2000)
        return f"{y:04d}{p2:02d}{p1:02d}"
    except: return "00000000"


def revision_sort_key(r):
    mark = str(r.get("mark", "")).strip().upper().replace("REV", "").strip()
    is_numeric = mark.isdigit()
    category = 1 if is_numeric else 0
    sub_val = int(mark) if is_numeric else 0
    return (category, sub_val, mark, get_date_val(r))


def pick_latest_revision(rev_history):
    if not rev_history: return {}
    return max(rev_history, key=revision_sort_key)


def validate_fields(fields: dict) -> dict:
    warnings = []
    dn = fields.get("drawingNumber", "")
    dn_valid = bool(dn and re.match(r'^[A-Za-z0-9][A-Za-z0-9\-_/\.]{0,30}$', dn.strip()))
    rev = fields.get("revision", "")
    date = fields.get("date", "")
    date_valid = is_date_pattern(date)
    return {"drawingNumberValid": dn_valid, "revisionValid": True, "dateValid": date_valid, "warnings": warnings}


def compute_confidence(fields: dict, validation: dict) -> float:
    score = 0.0
    if fields.get("drawingNumber"): score += 0.3
    if fields.get("drawingTitle"): score += 0.3
    if fields.get("revision"): score += 0.2
    if fields.get("date"): score += 0.2
    return float(f"{min(score, 1.0):.3f}")


def normalize_fields(fields: dict) -> dict:
    for k, v in fields.items():
        if isinstance(v, str): fields[k] = v.strip()
    return fields


def extract_locally_pass(pdf_path: str, extraction_mode: str = "layout") -> dict:
    fields = {
        "drawingNumber": "", "drawingTitle": "", "description": "Locally extracted",
        "drawingDescription": "", "revision": "0", "date": "", "scale": "",
        "clientName": "", "projectName": "", "remarks": "", "revisionHistory": []
    }
    
    fitz = None
    try: import fitz # type: ignore
    except: pass

    full_text, blocks, w, h = "", [], 800.0, 600.0
    if fitz:
        try:
            with fitz.open(pdf_path) as doc:
                if len(doc) > 0:
                    p = doc[0]; full_text = str(p.get_text("text")); blocks = p.get_text("blocks")
                    w, h = float(p.rect.width), float(p.rect.height)
        except: pass

    if not pdfplumber:
        fields["description"] = "Error: pdfplumber not installed"; return fields

    try:
        with pdfplumber.open(pdf_path) as pdf:
            page = pdf.pages[0]
            rev_region = page.within_bbox(get_bottom_right_region(page))
            rev_region_text = rev_region.extract_text() or ""
            
            if extraction_mode == "ocr" and pytesseract and convert_from_path:
                try:
                    images = convert_from_path(pdf_path, first_page=1, last_page=1, dpi=300)
                    text = pytesseract.image_to_string(images[0]) if images else ""
                except: text = ""
            elif extraction_mode == "raw": text = page.extract_text(layout=False) or ""
            else: text = page.extract_text(layout=True) or ""

            if not text: return fields
            clean_text = re.sub(r'(([A-Z])\2){3,}', fix_doubled, text)
            clean_text = re.sub(r'\bN\s+O(?=\.|\s|:)', 'NO', clean_text, flags=re.I)
            augmented_text = clean_text + "\n" + rev_region_text

            # 1. Drawing Number
            dn_match = re.search(r'(?:DWG\s*(?:NO)?|Drawing\s*#)\s*[:.\s]+(\S+)', clean_text, re.I)
            if dn_match: fields["drawingNumber"] = dn_match.group(1).strip()
            
            if not fields["drawingNumber"]:
                fn_hint = os.path.basename(pdf_path).split('_')[0]
                fields["drawingNumber"] = fn_hint if len(fn_hint) > 3 else os.path.basename(pdf_path).replace(".pdf", "")

            # 2. Drawing Title
            candidates = []
            if blocks:
                for blk in blocks:
                    if len(blk) < 5: continue
                    x0, y0, x1, y1, txt = blk[0], blk[1], blk[2], blk[3], blk[4]
                    if x0 > w * 0.2 and y0 > h * 0.3:
                        ct = txt.replace("\n", " ").strip()
                        if is_valid_title_candidate(ct):
                            score = (float(y1)/h) + (float(x1)/w) + score_title(ct)/1000.0
                            candidates.append({"v": ct, "s": score})
            
            if candidates:
                candidates.sort(key=lambda x: x["s"], reverse=True)
                fields["drawingTitle"] = candidates[0]["v"]

            # Explicit label checks
            for line in clean_text.splitlines():
                m = re.search(r'\bDWG\s+DESCRIPTION\s*[:.]\s*(.*)', line, re.I)
                if m:
                    val = strip_all_dates(m.group(1).strip())
                    if is_valid_title_candidate(val): fields["drawingTitle"] = val; break

            # 3. Revision History
            history = []
            seen_marks = set()
            try:
                tbls = page.extract_tables()
                for tbl in tbls:
                    if not tbl or len(tbl) < 2: continue
                    num_cols = len(tbl[0])
                    c_date, c_mark, c_desc = -1, -1, -1
                    for j in range(num_cols):
                        v_hdr = str(tbl[0][j] or '').upper()
                        if "DATE" in v_hdr: c_date = j
                        elif "REV" in v_hdr or "MK" in v_hdr: c_mark = j
                        elif "DESC" in v_hdr or "REMARK" in v_hdr: c_desc = j
                    
                    if c_date >= 0:
                        for row in tbl[1:]:
                            d_val = str(safe_get(row, c_date)).strip()
                            if is_date_pattern(d_val):
                                m_val = str(safe_get(row, c_mark)).strip().upper()
                                r_val = str(safe_get(row, c_desc)).strip()
                                m_clean = re.sub(r'[^A-Z0-9]', '', m_val)
                                if m_clean and m_clean not in seen_marks:
                                    history.append({"mark": m_clean, "date": d_val, "remarks": r_val})
                                    seen_marks.add(m_clean)
            except: pass
            
            if not history:
                # Regex fallback
                rows = re.findall(r'^\s*([A-Z0-9]{1,2})\s+(.*?)\s+(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\s*$', augmented_text, re.M)
                for r in rows:
                    if r[0] not in seen_marks:
                        history.append({"mark": r[0], "date": r[2], "remarks": r[1]})
                        seen_marks.add(r[0])

            fields["revisionHistory"] = history
            latest = pick_latest_revision(history)
            if latest:
                fields["revision"] = latest.get("mark", "")
                fields["date"] = latest.get("date", "")
                fields["remarks"] = latest.get("remarks", "")

    except Exception as e:
        fields["description"] = f"Local error: {str(e)}"
    return fields


def extract_locally(pdf_path: str) -> dict:
    fields = extract_locally_pass(pdf_path, extraction_mode="layout")
    def is_inc(f): return not (f.get("drawingNumber") and f.get("drawingTitle"))
    if is_inc(fields):
        f2 = extract_locally_pass(pdf_path, extraction_mode="raw")
        for k in ["drawingNumber", "drawingTitle", "revision", "date"]:
            if not fields.get(k) and f2.get(k): fields[k] = f2[k]
    return fields


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf_path")
    args = parser.parse_args()
    if not os.path.exists(args.pdf_path):
        print(json.dumps({"success": False, "error": "File not found"})); sys.exit(1)
    try:
        raw = extract_locally(args.pdf_path)
        validation = validate_fields(raw)
        raw = normalize_fields(raw)
        print(json.dumps({"success": True, "confidence": compute_confidence(raw, validation), "fields": raw, "validation": validation}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e), "trace": traceback.format_exc()})); sys.exit(1)

if __name__ == "__main__":
    main()
