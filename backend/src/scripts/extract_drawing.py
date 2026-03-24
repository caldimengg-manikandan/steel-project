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
def get_bottom_right_region(page):
    """Returns the coordinates for the bottom-right 30% of the page."""
    width = float(page.width)
    height = float(page.height)
    # x0, y0, x1, y1 (y0 is 50% down, x0 is 60% across)
    return (width * 0.6, height * 0.5, width, height)


def safe_get(lst: Any, idx: Any, default: Any = "") -> Any:
    """Safely get from a list by index, bypassing strict type checking."""
    try:
        if lst is not None and idx is not None:
            idx_int = int(idx)
            if idx_int >= 0 and len(list(lst)) > idx_int:
                return list(lst)[idx_int]
    except Exception:
        pass
    return default


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


def normalize_date_string(date_str):
    if not date_str:
        return ""
    
    # Extract only the relevant date part to avoid trailing/leading junk characters
    m_ext = re.search(r'(\d{1,2}\s*[-/\.]\s*\d{1,2}\s*[-/\.]\s*(?:20\d{2}|19\d{2}|\d{2})|'
                      r'(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,]+\d{1,2}[\s,]+\d{4})', date_str, re.I)
    if m_ext:
        date_str = m_ext.group(1)

    d = date_str.strip().replace("/", "-").replace(".", "-")
    d = re.sub(r'\s+', '', d)

    # Handle "Jul 28 2025" -> "28-07-2025"
    m = re.search(r'([A-Z]{3,})\s*(\d{1,2})\s*(\d{4})', d, re.I)
    if m:
        month_map = {
            'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04', 'MAY': '05', 'JUN': '06',
            'JUL': '07', 'AUG': '08', 'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12'
        }
        m_g1 = m.group(1)
        if m_g1:
            m_g1_str: Any = str(m_g1)
            month_abbr = m_g1_str[0:3].upper() # type: ignore
            month = month_map.get(month_abbr)
            if month:
                return f"{int(m.group(2)):02d}-{month}-{m.group(3)}" # type: ignore
    return d


def is_date_pattern(s):
    if not s: return False
    return bool(re.search(r'\d{1,2}\s*[-/\.]\s*\d{1,2}\s*[-/\.]\s*(?:20\d{2}|19\d{2}|\d{2})|'
                          r'(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,]+\d{1,2}[\s,]+\d{4}', s, re.I))


def strip_all_dates(s: str) -> str:
    """
    Remove any date patterns found anywhere in the string.
    Targeting common patterns like '01/23/2025', '23/2/26', 'Jan 20, 2025'.
    """
    if not s: return ""
    
    # 1. Broad numeric dates: MM/DD/YYYY, DD/MM/YYYY, YY/MM/DD, etc.
    # Handles 2 or 4 digit years, short months, and lots of space around separators.
    numeric_date = r'\b(?:\d{1,4}\s*[-/\.]\s*\d{1,2}\s*[-/\.]\s*(?:20\d{2}|19\d{2}|\d{2}))\b'
    
    # 2. Year-first or unusual separators
    year_first = r'\b(?:(?:20\d{2}|19\d{2})\s*[-/\.]\s*\d{1,2}\s*[-/\.]\s*\d{1,2})\b'
    
    # 3. Alpha dates: Jan 23 2025
    alpha_date = r'\b(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,]+\d{1,2}[\s,]+\d{4})\b'
    
    # Apply removals
    for pat in [numeric_date, year_first, alpha_date]:
        s = re.sub(pat, ' ', s, flags=re.I)
    
    # 4. Handle cases like '23/2/26base plate' where no word boundary exists on one side
    # Specifically catch the digits/slashes combo at the very start or very end
    s = re.sub(r'^\s*[\d\s\-/]{6,}\b', ' ', s) 
    s = re.sub(r'\b[\d\s\-/]{6,}\s*$', ' ', s)
    
    # Clean up excess whitespace
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def fix_doubled(m):
    s = m.group(0)
    return "".join(s[i] for i in range(0, len(s), 2))


def clean_rem(s):
    if not s:
        return ""
    
    # Strip leading 'x ', 'X ', 'v ', '*', or '-' noise that often comes from PDF checkmarks or artifacts
    s = re.sub(r'^[xXv\*\-\.\s]+(?=[A-Z0-9])', '', s).strip()

    # Strip shop/general notes that bleed into the remarks column due to PDF layout.
    # These are numbered list items like "1. ALL PLATES AND ANGLES ATTACHED SHALL BE..."
    # that appear on the same line as the actual revision remark.
    # Strategy: if the string starts with a shop note pattern, find the last numbered note
    # and take only what follows it.
    #
    # Example: "1. ALL PLATES ... U.N.O. A GSV ISSUED FOR APPROVAL"
    #   → we want just "ISSUED FOR APPROVAL"
    #
    # We look for "ISSUED FOR ..." or known revision phrases after a note boundary.
    rev_phrase_match = re.search(
        r'\b(ISSUED\s+FOR\s+(?:APPROVAL|FABRICATION|CONSTRUCTION|INFORMATION|BID|TENDER)|'
        r'FOR\s+(?:APPROVAL|FABRICATION|CONSTRUCTION|INFORMATION)|'
        r'APPROVED\b|PRELIMINARY\b|FINAL\b)',
        s, re.I
    )
    if rev_phrase_match and rev_phrase_match.start() > 0:
        # Check if there's shop note noise before it
        prefix = s[:rev_phrase_match.start()].strip()
        # If the prefix looks like shop note content (contains a numbered list item), strip it
        if re.search(r'\b\d+\.\s+[A-Z]', prefix, re.I) or re.search(r'\bU\.N\.O\b', prefix, re.I):
            s = s[rev_phrase_match.start():].strip()
    
    patterns = [
        r'DRAWN\s+BY', r'PROJ[.\s]*NO', r'PROJ', r'DATE', r'CONTRACTOR',
        r'CHECKED\s+BY', r'CHECKED', r'NO\b', r'N\s*O\b', r'REV[.\s]*#',
        r'REV\b', r'MARK\b', r'PAGE\b', r'DWG\b', r'HOLES', r'PAINT', r'FINISH'
    ]
    regex = r'\s+(?:' + '|'.join(patterns) + r')\b'
    parts = re.split(regex, s, flags=re.I)
    res = parts[0].strip()
    res = re.sub(r'\s+', ' ', res)
    res = re.sub(r'[:.\-\s]+$', '', res)
    return res


def is_valid_title_candidate(s: str) -> bool:
    """Check if string is a plausible drawing title (not a note, status, or date)."""
    if not s or len(s.strip()) < 3:
        return False
    # Avoid purely numeric/date strings
    if re.match(r'^[\d\s\-\./\#]+$', s):
        return False
    s_up = s.upper().strip()
    if BODY_NOTE_PATTERN.match(s_up):
        return False
    if any(bad in s_up for bad in BAD_TITLES):
        return False
    # Exclude common status phrases
    if s_up in ("FOR FABRICATION", "FOR APPROVAL", "FOR CONSTRUCTION", "ISSUED FOR APPROVAL"):
        return False
    # Exclude standard finish specs that might have been caught
    if re.match(r'^(?:PAINT|FINISH|GALV|COAT)\b', s_up):
        return False
    return True


def score_title(s: str) -> int:
    """
    Score title quality based on length, keywords, and noise.
    Aiming for: 'COLUMN/BEAM DETAIL' instead of 'C COLUMN PER PLAN L OF COLUMN/BEAM DETAIL-2'
    """
    if not is_valid_title_candidate(s):
        return -1
    
    s_up = s.upper().strip()
    current_score: int = 100  # Base logic: shorter is better, provided it's valid
    
    # Reward keywords (Strong signal)
    keyword_matches = [k for k in KEYWORDS if k in s_up]
    if keyword_matches:
        current_score += 1000  # Increased reward
        current_score += len(keyword_matches) * 50
        # Extra reward if the title STARTS with or IS exactly a keyword
        if any(s_up.startswith(k) for k in keyword_matches):
            current_score += 200
            
    if "DETAIL" in s_up:
        current_score += 300
        
    # Heuristic: shorter, concise titles are much more likely to be correct
    current_score -= len(s) * 3
    
    # Penalize metadata noise commonly found in long accidental extractions
    noise_words = [' PER ', ' OF ', ' FOR ', ' PLAN ', ' BY ', ' NO.', ' REF ', ' DWG ', ' SHEET ']
    current_score -= sum(80 for noise in noise_words if noise in s_up)
            
    # Penalize excessive punctuation/numeric junk in title
    junk_chars: int = sum(1 for c in s if not c.isalnum() and not c.isspace())
    current_score -= junk_chars * 15
    
    # If the title contains characters that look like a drawing number (dots/dashes/digits), penalize it
    if re.search(r'\b[A-Z]?\d+[-.]\d+\b', s_up):
        current_score -= 500
        
    # Penalize suspicious hyphenated project names if no keywords found
    if "-" in s_up and not keyword_matches:
        current_score -= 300

    return max(0, current_score)


def get_date_val(r):
    d = r.get("date", "")
    m = re.search(r'(\d+)[-/](\d+)[-/](\d+)', d)
    if not m: return "00000000"
    try:
        p1, p2, p3 = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if p1 > 1900: y, mo, da = p1, p2, p3 # YYYY-MM-DD
        elif p3 > 1900:
            y = p3
            if p2 > 12: mo, da = p1, p2 # p1=MM, p2=DD
            else: mo, da = p2, p1 # default to DD-MM (international)
        else:
            # Fallback: treat as DD-MM-YY
            y = p3 + 2000 if p3 < 100 else p3
            mo, da = p2, p1

        if y < 100:
            y += 2000
        return f"{y:04d}{mo:02d}{da:02d}"
    except Exception:
        return ""


def revision_sort_key(r):
    """
    Sort key so that the **highest** revision floats to the TOP (index -1).

    Priority rules (ascending = lower priority first):
      1. Alpha-only marks (Approval: A < B < C …) — numeric sort value 0
      2. Numeric marks (Fabrication: 0 < 1 < 2 …) — numeric sort value 1
         (fabrication always wins over alphabetical approval)
      3. Within the same category, use the numeric value / alphabetical order.
      4. Date as final tiebreaker.

    Returns a tuple so Python's sort puts the best revision last.
    """
    mark = str(r.get("mark", "")).strip().upper()
    # Strip leading "REV" prefix if present
    mark = re.sub(r'^REV[\s\-_]*', '', mark).strip()

    is_numeric = mark.isdigit() or (len(mark) > 1 and mark[0].isdigit())

    if is_numeric:
        # Fabrication: numeric mark — category 1 (higher priority)
        m_val = re.match(r'\d+', mark)
        if m_val:
            num_val = int(m_val.group())
        else:
            num_val = 0
        category = 1          # beats alphabetical
        sub_val  = num_val
        alpha_val = ''
    else:
        # Approval: alpha mark — category 0 (lower priority)
        category = 0
        sub_val  = 0
        alpha_val = mark      # 'A' < 'B' < 'C' … via string comparison

    date_str = get_date_val(r) or '00000000'
    return (category, sub_val, alpha_val, date_str)


def pick_latest_revision(rev_history):
    """
    Given a list of revision dicts [{mark, date, remarks}, …],
    return the single entry that represents the most advanced revision.

    Fabrication (numeric) always beats Approval (alpha).
    Within the same category, higher value wins.
    Date is used as a tiebreaker only within the same category+value.
    """
    if not rev_history:
        return {}
    return max(rev_history, key=revision_sort_key)


# ── Validation Logic ──────────────────────────────────────
def validate_fields(fields: dict) -> dict:
    warnings = []
    dn = fields.get("drawingNumber", "")
    dn_valid = bool(dn and re.match(r'^[A-Za-z0-9][A-Za-z0-9\-_/\.]{0,30}$', dn.strip()))
    if not dn_valid:
        warnings.append(f"Drawing number '{dn}' format may be invalid")

    rev = fields.get("revision", "")
    rev_clean = rev.strip().upper().replace("REV", "").strip()
    rev_valid = bool(rev and (rev_clean.isdigit() or (len(rev_clean) == 1 and rev_clean.isalpha())))
    if not rev_valid and rev:
        warnings.append(f"Revision mark '{rev}' may not follow standard format")

    date = fields.get("date", "")
    date_valid = bool(date and re.search(r'\d{1,2}\s*[-/\.]\s*\d{1,2}\s*[-/\.]\s*(?:20\d{2}|19\d{2}' + r'|\d{2})\b', date))
    if not date_valid and date:
        warnings.append(f"Date '{date}' format may be non-standard")

    return {
        "drawingNumberValid": dn_valid,
        "revisionValid":      rev_valid,
        "dateValid":          date_valid,
        "warnings":           warnings,
    }


def compute_confidence(fields: dict, validation: dict) -> float:
    score = 0.0
    dn = fields.get("drawingNumber", "")
    if dn:
        score += 0.20
        if validation.get("drawingNumberValid"):
            score += 0.10

    title = fields.get("drawingTitle", "") or fields.get("drawingDescription", "")
    if title:
        score += 0.25

    rev = fields.get("revision", "")
    if rev:
        score += 0.12
        if validation.get("revisionValid"):
            score += 0.08

    date = fields.get("date", "")
    if date:
        score += 0.08
        if validation.get("dateValid"):
            score += 0.07

    if fields.get("clientName") or fields.get("projectName"):
        score += 0.10

    # Refined to bypass overly strict type check on round()
    final_score = min(score, 1.0)
    return float(f"{final_score:.3f}")


def normalize_fields(fields: dict) -> dict:
    rev = fields.get("revision", "").strip()
    if rev.lower().startswith("rev"):
        rev = "Rev " + rev[3:].strip()
    fields["revision"] = rev

    date = fields.get("date", "").strip()
    date = re.sub(r'[/\.]', '-', date)
    fields["date"] = date

    for k, v in fields.items():
        if isinstance(v, str):
            fields[k] = v.strip()

    return fields


def extract_locally_pass(pdf_path: str, extraction_mode: str = "layout") -> dict:
    fields_dict: Dict[str, Any] = {
        "drawingNumber": "",
        "drawingTitle": "",
        "description": "Locally extracted",
        "drawingDescription": "",
        "revision": "0",
        "date": "",
        "scale": "",
        "clientName": "",
        "projectName": "",
        "remarks": "",
        "revisionHistory": []
    }
    fields = fields_dict


    if not pdfplumber:
        fields["description"] = "Error: pdfplumber not installed"
        return fields

    try:
        with pdfplumber.open(pdf_path) as pdf:
            page = pdf.pages[0]
            
            # --- Region-Based Optimization ---
            # Revisions are almost always in the bottom-right.
            rev_region = page.within_bbox(get_bottom_right_region(page))
            rev_region_text = rev_region.extract_text() or ""
            
            # Stage 1-5 Mode Handling
            if extraction_mode == "ocr":
                if pytesseract and convert_from_path:
                    try:
                        images = convert_from_path(pdf_path, first_page=1, last_page=1, dpi=300)
                        if images:
                            text = pytesseract.image_to_string(images[0])
                        else:
                            text = ""
                    except Exception:
                        text = ""
                else:
                    text = ""
            elif extraction_mode == "geometric":
                words = page.extract_words(x_tolerance=1, y_tolerance=1)
                if not words:
                    text = ""
                else:
                    words.sort(key=lambda w: w['top'])
                    word_lines: List[List[Any]] = []
                    words_any: Any = words
                    curr: List[Any] = [words_any[0]]
                    ctop = float(words_any[0]['top'])
                    cbot = float(words_any[0]['bottom'])
                    for w in words_any[1:]:
                        w_any: Any = w
                        cy = (float(w_any['top']) + float(w_any['bottom'])) / 2
                        if ctop - 4 <= cy <= cbot + 4:
                            curr.append(w_any)
                            ctop = min(ctop, float(w_any['top']))
                            cbot = max(cbot, float(w_any['bottom']))
                        else:
                            word_lines.append(curr)
                            curr = [w_any]
                            ctop = float(w_any['top'])
                            cbot = float(w_any['bottom'])
                    if curr:
                        word_lines.append(curr)
                    final_text: List[str] = []
                    for l in word_lines:
                        l_any: Any = l
                        l_any.sort(key=lambda x: float(str(x.get('x0', 0))))
                        line_str = ''
                        prev_x1 = -999.0
                        for w_in_l in l_any:
                            w_in_l_any: Any = w_in_l
                            wx0 = float(str(w_in_l_any.get('x0', 0)))
                            if prev_x1 != -999.0 and wx0 - prev_x1 > 5.0:
                                line_str += ' '
                            line_str += str(w_in_l_any.get('text', ''))
                            prev_x1 = float(str(w_in_l_any.get('x1', 0)))
                        final_text.append(line_str.strip())
                    text = '\n'.join(final_text)
            elif extraction_mode == "raw":
                text = page.extract_text(layout=False) or ""
            else: # "layout"
                text = page.extract_text(layout=True, x_tolerance=2.0) or ""

            if not text:
                return fields

            clean_text = re.sub(r'(([A-Z])\2){3,}', fix_doubled, text)
            clean_text = re.sub(r'\bN\s+O(?=\.|\s|:)', 'NO', clean_text, flags=re.I)
            
            # Combine full text with targeted region text for better coverage
            augmented_text = clean_text + "\n" + rev_region_text

            # --- 1. Drawing Number ---
            fn_base = os.path.basename(pdf_path).split('_')
            fn_hint = next((p for p in fn_base if re.search(r'\d+[A-Z]\d+|S-\d+|[A-Z]{2,}\d+|[a-z]+\d+', p, re.I)), "")

            dn_match = re.search(r'(?:DWG\s*(?:NO)?|Drawing\s*#)\s*[:.\s]+(\S+)', clean_text, re.I)
            if dn_match:
                dn_val = dn_match.group(1).strip()
                if dn_val.upper() not in ["DESCRIPTION", "TITLE", "PROJECT", "DWG", "STEEL", "FAB"] and \
                   len(dn_val) > 2 and any(c.isdigit() for c in dn_val):
                    fields["drawingNumber"] = dn_val

            if not fields["drawingNumber"] and fn_hint:
                fields["drawingNumber"] = fn_hint.replace(".pdf", "")

            if not fields["drawingNumber"]:
                pl_match = re.search(r'(?:DWG\s+)?(pl\d{3,}|[A-Z\d]{5,})', clean_text, re.I)
                fields["drawingNumber"] = pl_match.group(1) if pl_match else (fn_hint or os.path.basename(pdf_path).replace(".pdf", ""))

            # --- 2. Drawing Title (Multi-pass extraction) ---
            all_lines: List[str] = clean_text.splitlines()

            # ── Priority 1: Explicit DWG DESCRIPTION / Drawing Title labels ──
            # These are definitive — if found, use immediately without scoring
            explicit_title = ""

            # Check for inline "DWG DESCRIPTION: <title>" anywhere in text (passes A, B, C)
            for line in all_lines:
                is_dwg_desc = re.search(r'\bDWG\s+DESCRIPTION\s*[:.]\s*', line, re.I)
                if is_dwg_desc:
                    m = re.search(r'DWG\s+DESCRIPTION\s*[:.]\s*(.+)', line, re.I)
                    if m:
                        val = strip_all_dates(m.group(1).strip())
                        if val and is_valid_title_candidate(val):
                            explicit_title = val
                            break

            # Multi-line: label alone on a line, value on next
            if not explicit_title:
                m2 = re.search(
                    r'DWG\s+DESCRIPTION\s*[:.\-\s]*\n?\s*([A-Z0-9\s,&/\-]+?)(?=\s\s+|\n|[A-Z]{3,}:|$)',
                    clean_text, re.I
                )
                if m2:
                    val = strip_all_dates(m2.group(1).strip())
                    if val and is_valid_title_candidate(val):
                        explicit_title = val

            # Reversed scan (bottom-right title blocks have label at end)
            if not explicit_title:
                for line in reversed(all_lines):
                    if re.search(r'DWG\s+DESCRIPTION', line, re.I):
                        m = re.search(r'DWG\s+DESCRIPTION\s*[:.]\s*(.+)', line, re.I)
                        if m:
                            val = strip_all_dates(m.group(1).strip())
                            if val and is_valid_title_candidate(val):
                                explicit_title = val
                                break

            # Drawing Title label
            if not explicit_title:
                m1 = re.search(r'Drawing\s*Title\s*[:.\s]+(\S[^\n]*)', clean_text, re.I)
                if m1:
                    val = strip_all_dates(m1.group(1).strip())
                    if val and is_valid_title_candidate(val):
                        explicit_title = val

            # Drawing Title label spanning next line
            if not explicit_title:
                for i, line in enumerate(all_lines):
                    if re.search(r'Drawing\s*Title\s*:\s*$', line.rstrip(), re.I):
                        for j in range(i + 1, min(i + 5, len(all_lines))):
                            line_j = all_lines[j] # type: ignore
                            candidate = line_j.strip()
                            if candidate and not HARD_STOP_PATTERN.match(candidate):
                                val = strip_all_dates(candidate)
                                if val and is_valid_title_candidate(val):
                                    explicit_title = val
                                break

            # ── If explicit label found → use it directly ──
            if explicit_title:
                fields["drawingTitle"] = explicit_title
                fields["drawingDescription"] = explicit_title
            else:
                # ── Priority 2: Scored keyword candidates (fallback only) ──
                candidates: List[str] = []

                # Scan for any DESCRIPTION label not preceded by PROJECT
                for line in all_lines:
                    is_just_desc = re.search(r'\bDESCRIPTION\s*[:.]\s*', line, re.I) and not re.search(r'PROJECT', line, re.I)
                    if is_just_desc:
                        m = re.search(r'DESCRIPTION\s*[:.\s]+(.*?)(?=\s\s+|\n|[A-Z]{3,}:|$)', line, re.I)
                        if m: candidates.append(m.group(1).strip())

                # Pass D: Keyword + DETAIL synthesis
                complex_match = re.search(
                    r'\b(.*?(?:FRAME|STAIR|RAILING|HANDRAIL|GUARDRAIL|BEAM|COLUMN|PLATE|LADDER|STEEL|MISCELLANEOUS|ANGLE|BRACE)\s+DETAIL.*?)(?=\n|$)',
                    clean_text, re.I
                )
                if complex_match: candidates.append(complex_match.group(1).strip())

                for word in KEYWORDS:
                    if re.search(rf'^\s*{word}\s*$', clean_text, re.M | re.I):
                        candidates.append(word)
                    if re.search(rf'\b{word}\s+DETAIL\b', clean_text, re.I):
                        candidates.append(f"{word} DETAIL")

                # Pick the highest scored candidate
                best_title = ""
                best_score = -1
                for cand in candidates:
                    cand_clean = re.sub(r'^(?:DWG\s+)?DESCRIPTION\s*[:.\s]+', '', cand, flags=re.I).strip()
                    cand_clean = strip_all_dates(cand_clean)
                    s = score_title(cand_clean)
                    if s > best_score:
                        best_score = s
                        best_title = cand_clean

                fields["drawingTitle"] = best_title
                fields["drawingDescription"] = best_title

            # --- 3. Metadata ---
            # Using \s*[:.\-\s]*\n?\s* so if the value is printed on the next line or after much space, we still grab it
            proj_match = re.search(r'PROJECT\s+DESCRIPTION\s*[:.\-\s]*\n?\s*([A-Z0-9\s,&/\-]+?)(?=\s\s+|\n|PROJECT|CONTRACTOR|$)', clean_text, re.I)
            if proj_match:
                fields["projectName"] = proj_match.group(1).strip()

            if not fields["projectName"]:
                # Fallback to single line match
                pm2 = re.search(r'PROJECT\s+DESCRIPTION\s*[:.\s]+(.*?)(?=\n|$)', clean_text, re.I)
                if pm2:
                    fields["projectName"] = pm2.group(1).strip()

            client_match = re.search(r'PROJECT\s+OWNER\s*[:.\s]*\n?\s*([^\n]+)', clean_text, re.I)
            if client_match:
                fields["clientName"] = client_match.group(1).strip()

            # 1b. Remarks/Status in title block area
            m_rem_tb = re.search(r'\b(?:REMARKS|STATUS|NOTE[S]?)\b\s*[:.\-]+\s*([A-Z\s0-9\-_]{2,50})', text, re.I)
            if m_rem_tb:
                rem_val = m_rem_tb.group(1).strip()
                if len(rem_val) > 1 and not is_date_pattern(rem_val):
                    fields["remarks"] = rem_val

            # ─────────────────────────────────────────────────────────────
            # --- 4. Revisions ---
            # Phase 1: Try pdfplumber structured table extraction first.
            #   This reliably handles the multi-column layout where revision
            #   mark, description and date are in separate table cells.
            # Phase 2: Fall back to text-based regex patterns.
            # ─────────────────────────────────────────────────────────────

            seen_marks = set()   # de-dup by normalised mark

            def _add_rev(mark, date, remarks):
                """Normalise mark and add to history if not already seen."""
                norm_mark = re.sub(r'^REV[\s\-_]*', '', str(mark).strip(), flags=re.I).strip().upper()
                # Remove common noise if it's mixed with the mark (e.g. "A." -> "A")
                norm_mark = re.sub(r'[^A-Z0-9]', '', norm_mark)

                if not norm_mark or norm_mark in seen_marks:
                    return
                # Skip obvious noise tokens
                if norm_mark in ('NO', 'BY', 'OK', 'TO', 'OF', 'IN', 'IS', 'IT', 'AM', 'PM',
                                 'BE', 'AS', 'AN', 'AT', 'DO', 'GO', 'IF', 'OR', 'SO', 'UP',
                                 'DATE', 'MARK', 'ISSUE', 'REVISION', 'COPIES', 'DESTINATION',
                                 '#', 'DWG', 'SHEET'):
                    return
                # Skip numeric marks that are clearly not revisions (count of pieces etc)
                if norm_mark.isdigit() and int(norm_mark) > 99:
                    return
                # Revision marks are typically 1-2 chars. Skip longer ones unless they are noise we didn't catch.
                if len(norm_mark) > 2:
                    return
                seen_marks.add(norm_mark)
                if isinstance(fields.get("revisionHistory"), list):
                    fields["revisionHistory"].append({
                        "mark":    norm_mark,
                        "date":    normalize_date_string(date),
                        "remarks": clean_rem(remarks),
                    })

            # ── Phase 1: Structured table extraction ──────────────────────
            # Keywords that identify a "date" column header
            DATE_HDR   = re.compile(r'\b(?:date|dt|issued?)\b', re.I)
            # Keywords that identify a "revision/mark" column header
            REV_HDR    = re.compile(r'\b(?:rev(?:ision)?|issue|mark|no\.?)\b', re.I)
            # Keywords that identify a "description/remarks/destination" header
            DESC_HDR   = re.compile(r'\b(?:desc(?:ription)?|remark|destination|purpose|notes?|status|action)\b', re.I)
            # A cell that looks like a valid date (MM-DD-YYYY, DD-MM-YYYY, YYYY-MM-DD, Mon DD YYYY …)
            DATE_CELL  = re.compile(
                r'\b(\d{1,2}\s*[-/\.]\s*\d{1,2}\s*[-/\.]\s*(?:20\d{2}|19\d{2}|\d{2})|'
                r'(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,]+\d{1,2}[\s,]+\d{4})\b',
                re.I
            )
            # A cell that looks like a valid revision mark (single letter or 1-2 digits)
            MARK_CELL  = re.compile(r'^[A-Z0-9]{1,2}$', re.I)

            def _try_table_extraction(pdf_page):
                """
                Use pdfplumber table detection to find the revision history table.

                Handles both orientations:
                  • Header at TOP  → data rows are below  (table[header_idx+1:])
                  • Header at BOTTOM → data rows are above (table[:header_idx])

                Returns True if at least one revision was successfully extracted.
                """
                found_any = False
                tables = pdf_page.extract_tables()
                for table in tables:
                    if not table or len(list(table)) < 2:
                        continue

                    # ── Identify header row (check ALL rows, not just first 4) ──
                    header_idx = None
                    col_rev = col_date = col_desc = None

                    table_any: Any = table
                    table_list: List[Any] = [x for x in (table_any or [])]
                    for row_i, row in enumerate(table_list):
                        row_any: Any = row
                        row_list: List[Any] = [x for x in row_any] if row_any is not None else []
                        row_text = [str(c or '').strip() for c in row_list]
                        # Join multi-line cells (pdfplumber sometimes gives "\nIssue" for "Revision/\nIssue")
                        row_joined = [c.replace('\n', ' ').replace('/', ' ') for c in row_text]
                        # Only look at short cells for header keyword detection.
                        # Huge merged cells (>60 chars) contain entire drawing content and
                        # would give false positives (e.g. row 0 of BOM tables).
                        short_cells = [c for c in row_joined if len(c) <= 60]
                        has_rev  = any(REV_HDR.search(c) for c in short_cells)
                        has_date = any(DATE_HDR.search(c) for c in short_cells)
                        if has_rev and has_date:
                            header_idx = row_i
                            # Pick best columns for this header row
                            best_rev_score = -1
                            best_date_score = -1
                            best_desc_score = -1
                            
                            for ci, cell in enumerate(row_joined):
                                if len(cell) > 40: continue # Skip huge cells as headers
                                
                                if DATE_HDR.search(cell):
                                    col_date = ci
                                if REV_HDR.search(cell):
                                    col_rev = ci
                                if DESC_HDR.search(cell):
                                    col_desc = ci
                            break

                    if header_idx is None or col_rev is None or col_date is None:
                        continue

                    # If no description column found, pick the column closest to date
                    if col_desc is None and col_date is not None and header_idx is not None:
                        h_idx: Any = header_idx
                        header_row = list(table_list[h_idx]) if 0 <= h_idx < len(table_list) else [] # type: ignore
                        num_cols = len(header_row)
                        best_dist = 999
                        for j in range(num_cols):
                            if j != col_rev and j != col_date:
                                dist = abs(j - col_date)
                                if dist < best_dist:
                                    best_dist = dist
                                    col_desc = j

                    # ── Determine data row range ───────────────────────────────
                    # Header at top  → data rows come AFTER it
                    # Header at bottom → data rows come BEFORE it (common in this PDF format)
                    if header_idx == 0:
                        data_rows = [table_list[i] for i in range(1, len(table_list))]
                    elif header_idx == len(table_list) - 1:
                        # Header is the last row — data rows are everything before it
                        h_idx_val: Any = header_idx
                        data_rows = [table_list[i] for i in range(h_idx_val)] # type: ignore
                    else:
                        # Header is somewhere in the middle.
                        # Check if more data-like rows exist before or after it.
                        if header_idx is not None:
                            h_idx_mid: Any = header_idx
                            rows_after_any: Any  = [table_list[i] for i in range(h_idx_mid + 1, len(table_list))] # type: ignore
                            rows_before_any: Any = [table_list[i] for i in range(h_idx_mid)] # type: ignore
                            
                            rows_after: List[Any] = [x for x in rows_after_any] if rows_after_any else []
                            rows_before: List[Any] = [x for x in rows_before_any] if rows_before_any else []
                            
                            after_has_data  = any(
                                col_date is not None and col_rev is not None and
                                DATE_CELL.search(str(safe_get(r, col_date) or '')) and MARK_CELL.match(str(safe_get(r, col_rev) or '').strip())
                                for r in rows_after if r
                            )
                            before_has_data = any(
                                col_date is not None and col_rev is not None and
                                DATE_CELL.search(str(safe_get(r, col_date) or '')) and MARK_CELL.match(str(safe_get(r, col_rev) or '').strip())
                                for r in rows_before if r
                            )
                            if before_has_data and not after_has_data:
                                data_rows = rows_before
                            else:
                                data_rows = rows_after
                        else:
                            data_rows = []

                    # ── Parse data rows ───────────────────────────────────────
                    min_col = max(c for c in [col_rev, col_date, col_desc or 0] if c is not None)
                    for row in data_rows:
                        row_data = list(row) if row else []
                        if len(row_data) <= min_col:
                            continue
                        
                        if col_rev is not None and col_date is not None:
                            mark    = str(safe_get(row_data, col_rev) or '').strip()
                            date    = str(safe_get(row_data, col_date) or '').strip()
                            remarks = str(safe_get(row_data, col_desc) or '').strip() if col_desc is not None else ''
                        else:
                            continue

                        # Validate: mark must look like a revision mark (1-2 alnum chars)
                        if not mark or not MARK_CELL.match(mark):
                            continue
                        # Date must look like a real date
                        if not date or not DATE_CELL.search(date):
                            continue

                        _add_rev(mark, date, remarks)
                        found_any = True

                    if found_any:
                        return True

                return False

            # Try table extraction first
            table_success = _try_table_extraction(page)

            # ── Phase 2: Text regex patterns (fallback) ───────────────────
            if not table_success:
                # Pattern 1: leading row-number  e.g. "1  A  Issued for Approval  28-01-2026"
                rev_rows_new = re.findall(
                    r'^[ \t]*(\d+)[ \t]+([A-Z0-9]{1,2})[ \t]+(.*?)[ \t]+(\d{1,2}\s*[-/]\s*\d{1,2}\s*[-/]\s*(?:20\d{2}|19\d{2}|\d{2}))[ \t]*$',
                    augmented_text, re.I | re.M
                )
                for r in rev_rows_new:
                    _add_rev(r[1], r[3], r[2])

                # Pattern 2: mark  initials  "Mon DD YYYY"  description
                rev_rows_date_first = re.findall(
                    r'\b([A-Z0-9]{1,2}|REV[ \t][A-Z0-9]{1,2})\b[ \t]+(?:[A-Z]{2,4}[ \t]+)?\b([A-Z]{3,}[ \t]+\d{1,2}[ \t]*,?[ \t]*\d{4})\b[ \t]+(.*)',
                    augmented_text, re.I
                )
                for r in rev_rows_date_first:
                    _add_rev(r[0], r[1], r[2])

                # Pattern 3: mark  initials  description  "Mon DD YYYY"
                rev_rows_desc_first = re.findall(
                    r'\b([A-Z0-9]{1,2}|REV[ \t][A-Z0-9]{1,2})\b[ \t]+(?:[A-Z]{2,4}[ \t]+)?(.*?)[ \t]+\b([A-Z]{3,}[ \t]+\d{1,2}[ \t]*,?[ \t]*\d{4})\b(.*)',
                    augmented_text, re.I
                )
                for r in rev_rows_desc_first:
                    _add_rev(r[0], r[2], r[1])

                # Pattern 4 (fallback): mark  initials  DD-MM-YYYY or YYYY-MM-DD  description
                if not fields["revisionHistory"]:
                    rev_num = re.findall(
                        r'\b([A-Z0-9]{1,2})\b[ \t]+(?:[A-Z]{2,4}[ \t]+)?(?:.*?)[ \t]*\b(\d{1,2}\s*[-/]\s*\d{1,2}\s*[-/]\s*(?:20\d{2}|19\d{2}|\d{2}))\b[ \t]+(.*)',
                        augmented_text, re.I
                    )
                    for r in rev_num:
                        _add_rev(r[0], r[1], r[2])

                # Pattern 9: Generic mark + description + date (line-based)
                if not fields["revisionHistory"]:
                    for line in clean_text.splitlines():
                        m = re.search(r'^\s*([A-Z0-9]{1,2})\b[ \t]+(?:[A-Z]{2,3}[ \t]+)?(.*?)[ \t]+(\d{1,2}\s*[-/]\s*\d{1,2}\s*[-/]\s*(?:20\d{2}|19\d{2}|\d{2}))\s*$', line, re.I)
                        if m:
                            _add_rev(m.group(1), m.group(3), m.group(2))

                # Pattern 10: Generic mark + date + description (line-based)
                if not fields["revisionHistory"]:
                    for line in clean_text.splitlines():
                        m = re.search(r'^\s*([A-Z0-9]{1,2})\b[ \t]+(?:[A-Z]{2,3}[ \t]+)?(\d{1,2}\s*[-/]\s*\d{1,2}\s*[-/]\s*(?:20\d{2}|19\d{2}|\d{2}))[ \t]+(.*?)\s*$', line, re.I)
                        if m:
                            _add_rev(m.group(1), m.group(2), m.group(3))

                # Pattern 5 (broad fallback): "A  Issued for Approval  28/01/2026"
                if not fields["revisionHistory"]:
                    rev_broad = re.findall(
                        r'\b([A-Z0-9]{1,2})[ \t]+(Issued[ \t]+for[ \t]+\w+(?:[ \t]+\w+)?)[ \t]+(\d{1,2}\s*[-/]\s*\d{1,2}\s*[-/]\s*(?:20\d{2}|19\d{2}' + r'|\d{2}))\b',
                        augmented_text, re.I
                    )
                    for r in rev_broad:
                        _add_rev(r[0], r[2], r[1])
                        
                # Pattern 6: DD-MM-YYYY mark description
                if not fields["revisionHistory"]:
                    rev_date_first = re.findall(
                        r'\b(\d{1,2}\s*[-/]\s*\d{1,2}\s*[-/]\s*(?:20\d{2}|19\d{2}|\d{2}))\b[ \t]+\b([A-Z0-9]{1,2}|REV[ \t][A-Z0-9]{1,2})\b[ \t]+(.*)',
                        augmented_text, re.I
                    )
                    for r in rev_date_first:
                        _add_rev(r[1], r[0], r[2])

                # Pattern 7: Very broad line-based search for Alnum Mark + Date
                if not fields["revisionHistory"]:
                    for line in augmented_text.splitlines():
                        m_date = DATE_CELL.search(line)
                        if m_date:
                            date_str = m_date.group(0)
                            # Remove date from line to find mark
                            line_no_date = line.replace(date_str, " DATE ")
                            # Look for a mark (1-2 alnum chars) surrounded by word boundaries or at start
                            m_rev = re.search(r'(?:^|\s)([A-Z0-9]{1,2})(?:\s|$)', line_no_date)
                            if m_rev:
                                mark_val = m_rev.group(1).strip()
                                if mark_val not in ('NO', 'BY', 'OK', 'TO', 'OF', 'IN', 'IS', 'IT'):
                                    rem = line_no_date.replace(mark_val, "").replace(" DATE ", "").strip()
                                    # Skip if it looks like a quantity or BOM line
                                    if re.search(r'\b(?:REQ\'D|QTY|PIECES?|LBS|WT|MARK|SIZE)\b', rem, re.I):
                                        continue
                                    _add_rev(mark_val, m_date.group(0), rem)

                # Pattern 8: Explicit search for DATE : or similar if still empty
                if not fields["revisionHistory"]:
                    m_date_explicit = re.search(r'\b(?:DATE|ISSUE|ISSUED|DT)\s*[:.\s]+\s*(\d{1,2}\s*[-/\.]\s*\d{1,2}\s*[-/\.]\s*(?:20\d{2}|19\d{2}|\d{2}))\b', augmented_text, re.I)
                    if m_date_explicit:
                        r_date = m_date_explicit.group(1)
                        # Find a nearby revision mark
                        m_rev_nearby = re.search(r'\b(?:REV|REVISION|MARK)\s*[:.\s]*([A-Z0-9]{1,2})\b', augmented_text, re.I)
                        r_mark = m_rev_nearby.group(1) if m_rev_nearby else "0"
                        _add_rev(r_mark, r_date, "")

            # FLEXIBLE FIELD DETECTION (Keywords & Multi-Region & Destination Mapping)
            if not fields["revisionHistory"]:
                # Try table-like row: # of Copies | Revision | Destination | Date
                # Example: ... GRADE: A36  1 0 FOR FABRICATION 09-22-2025
                row_pattern = re.findall(
                    r'\b(\d+)[ \t]+([A-Z]|\d{1,2})[ \t]+([A-Za-z][A-Za-z\s]*?)[ \t]+(\d{1,2}[-/\.]\d{1,2}[-/\.]\d{2,4})\b',
                    augmented_text, re.I
                )
                for r in row_pattern:
                    val_dest = r[2].strip()
                    val_dest_up = val_dest.upper()
                    if val_dest_up == "FORFABRICATION": val_dest = "FOR FABRICATION"
                    elif val_dest_up == "FORAPPROVAL": val_dest = "FOR APPROVAL"
                    elif val_dest_up == "FORCONSTRUCTION": val_dest = "FOR CONSTRUCTION"

                    if val_dest.upper() in ["FOR FABRICATION", "FOR APPROVAL", "FOR CONSTRUCTION", "ISSUED FOR APPROVAL", "ISSUED FOR FABRICATION"]:
                        _add_rev(r[1], r[3], val_dest)
                    else:
                        _add_rev(r[1], r[3], val_dest)

            if not fields["revisionHistory"]:
                # Broad text regex fallback for scattered tables without lines
                # Group 1: Mark, Group 3: Dest/Remarks, Group 4: Date
                scattered_pattern = re.findall(
                    r'\bREV(?:ISION)?\s*([A-Z0-9]{1,2})\b.*?(?:REMARKS|DESTINATION|STATUS)\s*([A-Za-z\s]{3,25}?).*?(?:DATE)\s*(\d{1,2}[-/\.]\d{1,2}[-/\.]\d{2,4})',
                    augmented_text, re.I | re.DOTALL
                )
                for r in scattered_pattern:
                    _add_rev(r[0], r[2], r[1].strip())

            if not fields["revisionHistory"]:
                # Individual keyword extraction across entire page
                # Date detection keywords
                date_kw = re.search(r'\b(?:DATE|ISSUE\s+DATE|DRAWING\s+DATE|DT)\s*[:.\-\|]?\s*(\d{1,2}\s*[-/\.]\s*\d{1,2}\s*[-/\.]\s*(?:20\d{2}|19\d{2}|\d{2}))\b', augmented_text, re.I)
                # Remarks detection keywords
                rem_kw = re.search(r'\b(?:REMARKS|DESTINATION|STATUS)\s*[:.\-\|]?\s*([A-Za-z\s]+?)(?=\s\s+|\n|$)', augmented_text, re.I)
                # Revision detection keywords
                rev_kw = re.search(r'\b(?:REV|REVISION|REVISION/ISSUE)\s*[:.\-\|]?\s*([A-Z]|\d{1,2})\b', augmented_text, re.I)
                
                if rev_kw or date_kw or rem_kw:
                    r_mark = rev_kw.group(1) if rev_kw else ("0" if date_kw else "0")
                    r_date = date_kw.group(1) if date_kw else ""
                    r_rem = rem_kw.group(1).strip() if rem_kw else ""
                    
                    if r_mark and r_mark not in ('NO', 'BY', 'OK', 'TO', 'OF', 'IN', 'IS', 'IT', 'DATE'):
                         _add_rev(r_mark, r_date, r_rem)

            # Sort chronologically (date ascending) so history is in order
            rev_history = fields.get("revisionHistory")
            if isinstance(rev_history, list):
                rev_history.sort(key=get_date_val)

            if fields["revisionHistory"]:
                # ── Pick latest using fabrication-priority rule ──
                latest = pick_latest_revision(fields["revisionHistory"])
                fields["revision"] = latest["mark"]
                fields["date"]     = latest["date"]
                fields["remarks"]  = latest["remarks"]
            else:
                # Absolute fallback: if text OCR was destroyed by vertical text/grids,
                # check if the filename ends in _[REV] or -[REV]. e.g. "06D1005_A.pdf" -> "A"
                rev_match = re.search(r'[_ -]+([A-Za-z0-9]{1,2})\.pdf$', os.path.basename(pdf_path), re.I)
                if rev_match:
                    rev_candidate = rev_match.group(1).upper()
                    if rev_candidate not in ('ND', 'TH', 'ST'):
                        fields["revision"] = rev_candidate

    except Exception as e:
        fields["description"] = f"Local error: {str(e)}"
    return fields


def extract_locally(pdf_path: str) -> dict:
    """
    Production-level multi-stage extraction pipeline.
    Stage 1: Layout text extraction (pdfplumber layout=True)
    Stage 2: Geometric reconstruction (custom word-to-line logic)
    Stage 3: Table detection (via pdfplumber table extraction)
    Stage 4: OCR fallback (Tesseract)
    Stage 5: Regex validation (layout=False / raw scan)
    """
    
    # helper to check if critical fields are still missing
    def is_incomplete(f):
        # We consider it incomplete if any of the core metadata is missing
        req_keys = ["drawingNumber", "drawingTitle", "revision", "date"]
        return not all(str(f.get(k, "")).strip() for k in req_keys)

    # --- Stage 1: Layout ---
    fields = extract_locally_pass(pdf_path, extraction_mode="layout")
    
    # --- Stage 2 & 3: Geometric & Table (Interleaved in pass logic) ---
    if is_incomplete(fields):
        f_geo = extract_locally_pass(pdf_path, extraction_mode="geometric")
        # Merge results - only overwrite if current is empty
        for k in ["drawingNumber", "drawingTitle", "revision", "date", "remarks", "revisionHistory"]:
            if not str(fields.get(k, "")).strip() and str(f_geo.get(k, "")).strip():
                fields[k] = f_geo[k]
                
    # --- Stage 4: OCR Fallback ---
    if is_incomplete(fields):
        try:
            f_ocr = extract_locally_pass(pdf_path, extraction_mode="ocr")
            for k in ["drawingNumber", "drawingTitle", "revision", "date", "remarks", "revisionHistory"]:
                if not str(fields.get(k, "")).strip() and str(f_ocr.get(k, "")).strip():
                    fields[k] = f_ocr[k]
        except Exception:
            pass
            
    # --- Stage 5: Regex Validation (Raw Scan) ---
    if is_incomplete(fields):
        f_raw = extract_locally_pass(pdf_path, extraction_mode="raw")
        for k in ["drawingNumber", "drawingTitle", "revision", "date", "remarks", "revisionHistory"]:
            if not str(fields.get(k, "")).strip() and str(f_raw.get(k, "")).strip():
                fields[k] = f_raw[k]

    # Post-process missing spaces for common phrases
    if fields.get("remarks"):
        r_up = fields["remarks"].upper()
        if "FORFABRICATION" in r_up: fields["remarks"] = fields["remarks"].replace("FORFABRICATION", "FOR FABRICATION")
        if "FORAPPROVAL" in r_up: fields["remarks"] = fields["remarks"].replace("FORAPPROVAL", "FOR APPROVAL")
        if "FORCONSTRUCTION" in r_up: fields["remarks"] = fields["remarks"].replace("FORCONSTRUCTION", "FOR CONSTRUCTION")

    if fields.get("revisionHistory"):
        for rev_entry in fields["revisionHistory"]:
            rem = rev_entry.get("remarks", "")
            rem_up = rem.upper()
            if "FORFABRICATION" in rem_up: rev_entry["remarks"] = rem.replace("FORFABRICATION", "FOR FABRICATION")
            if "FORAPPROVAL" in rem_up: rev_entry["remarks"] = rem.replace("FORAPPROVAL", "FOR APPROVAL")
            if "FORCONSTRUCTION" in rem_up: rev_entry["remarks"] = rem.replace("FORCONSTRUCTION", "FOR CONSTRUCTION")

    return fields


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf_path", help="Path to PDF file")
    parser.add_argument("--api_key", default="", help="Removed - Not Used")
    parser.add_argument("--original_filename", default="", help="Original filename for logging")
    args = parser.parse_args()

    pdf_path = args.pdf_path

    if not os.path.exists(pdf_path):
        print(json.dumps({"success": False, "error": f"File not found: {pdf_path}"}))
        sys.exit(1)

    try:
        raw_dict = extract_locally(pdf_path)
        fields = {
            "drawingNumber":      raw_dict.get("drawingNumber",      ""),
            "drawingTitle":       raw_dict.get("drawingTitle",       ""),
            "description":        raw_dict.get("description",        ""),
            "drawingDescription": raw_dict.get("drawingDescription", ""),
            "revision":           raw_dict.get("revision",           ""),
            "date":               raw_dict.get("date",               ""),
            "scale":              raw_dict.get("scale",              ""),
            "clientName":         raw_dict.get("clientName",         ""),
            "projectName":        raw_dict.get("projectName",        ""),
            "remarks":            raw_dict.get("remarks",            ""),
            "revisionHistory":    raw_dict.get("revisionHistory", [])
        }

        validation = validate_fields(fields)
        fields = normalize_fields(fields)
        confidence = compute_confidence(fields, validation)

        print(json.dumps({
            "success":    True,
            "confidence": confidence,
            "fields":     fields,
            "validation": validation,
        }))

    except Exception as e:
        print(json.dumps({
            "success": False,
            "error":   str(e),
            "trace":   traceback.format_exc(),
        }))
        sys.exit(1)

if __name__ == "__main__":
    main()
