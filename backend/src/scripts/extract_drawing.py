import sys
import os
import json
import argparse
import re
import traceback
from typing import Optional, Dict, Any, List
from pydantic import BaseModel, Field

try:
    import pdfplumber
except ImportError:
    pdfplumber = None

try:
    import pytesseract
    from pdf2image import convert_from_path
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
BODY_NOTE_PATTERN = re.compile(r'^\s*(?:PAINT|PREPARATION|SSPC)\b', re.I)
HARD_STOP_PATTERN = re.compile(
    r'^\s*(?:Scale|Ref(?:erence)?|Contract\s*#|Drawing\s*#|Approved|Contractor)\b',
    re.I
)

KEYWORDS = [
    "HORIZONTAL BRACE", "VERTICAL BRACE", "BEAM DETAIL", "FRAME DETAIL",
    "PLATE", "ANGLE", "BEAM", "COLUMN", "CHANNEL", "HSS", "LINTEL", "CLIP",
    "STIFFENER", "BASE PLATE", "CAP PLATE", "BENT PLATE", "WELDMENT", "FRAME", 
    "DETAIL", "RAILING", "STAIR", "HANDRAIL", "KICKPLATE",
    "LADDER", "BRACING", "GIRT", "PURLIN", "MISCELLANEOUS", "EMBED PLATE"
]

BAD_TITLES = {"MARK", "QTY", "FT IN", "WEIGHT", "MATERIAL", "DATE", "REV", "CHECKED", "DRAWN", "PROJ", "CONTRACTOR"}


def normalize_date_string(date_str):
    if not date_str:
        return ""
    d = date_str.strip().replace("/", "-").replace(".", "-")
    # Handle "Jul 28 2025" -> "28-07-2025"
    m = re.search(r'([A-Z]{3,})\s+(\d{1,2})\s+(\d{4})', d, re.I)
    if m:
        month_map = {
            'JAN': '01', 'FEB': '02', 'MAR': '03', 'APR': '04', 'MAY': '05', 'JUN': '06',
            'JUL': '07', 'AUG': '08', 'SEP': '09', 'OCT': '10', 'NOV': '11', 'DEC': '12'
        }
        month_abbr = m.group(1)[:3].upper()
        month = month_map.get(month_abbr)
        if month:
            return f"{int(m.group(2)):02d}-{month}-{m.group(3)}"
    return d


def strip_leading_date(s):
    """Remove a date at the start of a string, return remaining text."""
    cleaned = re.sub(
        r'^[\d]{1,4}\s*[/\-\.]\s*[\d]{1,2}\s*[/\-\.]\s*[\d]{2,4}\s*',
        '', s
    ).strip()
    return cleaned if cleaned else s


def fix_doubled(m):
    s = m.group(0)
    return "".join(s[i] for i in range(0, len(s), 2))


def clean_rem(s):
    if not s:
        return ""
    patterns = [
        r'DRAWN\s+BY', r'PROJ[.\s]*NO', r'PROJ', r'DATE', r'CONTRACTOR',
        r'CHECKED\s+BY', r'CHECKED', r'NO\b', r'N\s*O\b', r'REV[.\s]*#',
        r'REV\b', r'MARK\b', r'PAGE\b', r'DWG\b', r'HOLES', r'PAINT'
    ]
    regex = r'\s+(?:' + '|'.join(patterns) + r')\b'
    parts = re.split(regex, s, flags=re.I)
    res = parts[0].strip()
    res = re.sub(r'\s+', ' ', res)
    res = re.sub(r'[:.\-\s]+$', '', res)
    return res


def get_date_val(r):
    d = r.get("date", "")
    m = re.search(r'(\d+)[-/](\d+)[-/](\d+)', d)
    if m:
        p1, p2, p3 = int(m.group(1)), int(m.group(2)), int(m.group(3))

        # YYYY-MM-DD (e.g. 2025-09-25)
        if p1 > 31:
            y, mo, da = p1, p2, p3

        # MM-DD-YYYY or DD-MM-YYYY (e.g. 09-25-2025)
        elif p3 > 31:
            y = p3
            if p2 > 12:
                # p2 must be day → p1 is month (MM-DD-YYYY)
                mo, da = p1, p2
            elif p1 > 12:
                # p1 must be day → p2 is month (DD-MM-YYYY)
                mo, da = p2, p1
            else:
                # Both ≤12; assume MM-DD-YYYY (common in US steel drawings)
                mo, da = p1, p2
        else:
            # Fallback: treat as DD-MM-YY
            y = p3 + 2000 if p3 < 100 else p3
            mo, da = p2, p1

        if y < 100:
            y += 2000
        return f"{y:04d}{mo:02d}{da:02d}"
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
        try:
            num_val = int(re.match(r'\d+', mark).group())
        except Exception:
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
    date_valid = bool(date and re.search(r'\d{1,4}[-/\.]\d{1,2}[-/\.]\d{2,4}', date))
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
    fields = {
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

    if not pdfplumber:
        fields["description"] = "Error: pdfplumber not installed"
        return fields

    try:
        with pdfplumber.open(pdf_path) as pdf:
            page = pdf.pages[0]
            
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
                    lines = []
                    curr = [words[0]]
                    ctop, cbot = words[0]['top'], words[0]['bottom']
                    for w in words[1:]:
                        cy = (w['top'] + w['bottom']) / 2
                        if ctop - 4 <= cy <= cbot + 4:
                            curr.append(w)
                            ctop = min(ctop, w['top'])
                            cbot = max(cbot, w['bottom'])
                        else:
                            lines.append(curr)
                            curr = [w]
                            ctop, cbot = w['top'], w['bottom']
                    if curr:
                        lines.append(curr)
                    final_text = []
                    for l in lines:
                        l.sort(key=lambda x: x['x0'])
                        line_str = ''
                        prev_x1 = -999
                        for w in l:
                            if prev_x1 != -999 and w['x0'] - prev_x1 > 5.0:
                                line_str += ' '
                            line_str += w['text']
                            prev_x1 = w['x1']
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

            # --- 2. Drawing Title ---
            lines = clean_text.splitlines()

            if not fields["drawingTitle"]:
                dt_match = re.search(r'Drawing\s*Title\s*:\s*(\S[^\n]*)', clean_text, re.I)
                if dt_match:
                    val = strip_leading_date(dt_match.group(1).strip())
                    if (len(val) > 1 and not re.match(r'^[\d/\-\.\s]+$', val) and not BODY_NOTE_PATTERN.match(val)):
                        fields["drawingTitle"] = val

            if not fields["drawingTitle"]:
                for i, line in enumerate(lines):
                    if re.search(r'Drawing\s*Title\s*:\s*$', line.rstrip(), re.I):
                        title_parts = []
                        j = i + 1
                        while j < min(i + 8, len(lines)):
                            candidate = lines[j].strip()
                            j += 1
                            if not candidate:
                                continue
                            if BODY_NOTE_PATTERN.match(candidate):
                                continue
                            candidate_no_date = strip_leading_date(candidate)
                            if re.match(r'^[\d/\-\.\s]+$', candidate_no_date) or not candidate_no_date:
                                continue
                            if HARD_STOP_PATTERN.match(candidate_no_date):
                                break
                            title_parts.append(candidate_no_date)
                        if title_parts:
                            fields["drawingTitle"] = " ".join(title_parts)
                        break

            if not fields["drawingTitle"]:
                # Multiline-safe DWG DESCRIPTION regex
                # Handles "DWG DESCRIPTION :\n HORIZONTAL BRACE DETAIL" or "DWG DESCRIPTION: HARIZONTAL..."
                dt_match_alt = re.search(r'DWG\s+DESCRIPTION\s*[:.\-\s]*\n?\s*([A-Z0-9\s,&/\-]+?)(?=\s\s+|\n|[A-Z]{3,}:|$)', clean_text, re.I)
                if dt_match_alt:
                    val = dt_match_alt.group(1).strip()
                    if len(val) > 2 and not BODY_NOTE_PATTERN.match(val):
                        fields["drawingTitle"] = val

            if not fields["drawingTitle"]:
                for line in reversed(lines):
                    if re.search(r'DWG\s+DESCRIPTION', line, re.I):
                        m = re.search(r'DWG\s+DESCRIPTION\s*[:\s]\s*(.+)', line, re.I)
                        if m:
                            val = m.group(1).strip()
                            if len(val) > 1:
                                fields["drawingTitle"] = val
                                break

            if not fields["drawingTitle"]:
                for line in reversed(lines):
                    if re.search(r'(?<!PROJECT\s)DESCRIPTION', line, re.I) and \
                       not re.search(r'DWG\s+DESCRIPTION|PROJECT\s+DESCRIPTION', line, re.I):
                        m = re.search(r'DESCRIPTION\s*[:.\s]+(.*?)(?=\n|[A-Z]{3,}:|MARK|QTY|FT|IN|WEIGHT|DATE|REV|PAGE|DWG|$)', line, re.I)
                        if m and len(m.group(1).strip()) > 2:
                            fields["drawingTitle"] = m.group(1).strip()
                            break

            # Fallback
            if not fields["drawingTitle"]:
                complex_match = re.search(r'\b(.*?(?:FRAME|STAIR|RAILING|HANDRAIL|BEAM|COLUMN|PLATE|LADDER)\s+DETAIL.*?)(?=\n|$)', clean_text, re.I)
                if complex_match and len(complex_match.group(1)) < 60:
                    fields["drawingTitle"] = complex_match.group(1).strip()
                else:
                    for line in lines:
                        line_clean = line.strip()
                        if 3 < len(line_clean) < 60 and not BODY_NOTE_PATTERN.match(line_clean) and not re.search(r'DWG\s+DESCRIPTION', line_clean, re.I):
                            if any(w in line_clean.upper() for w in KEYWORDS) and ('DETAIL' in line_clean.upper() or 'FRAME' in line_clean.upper() or 'MISCELLANEOUS' in line_clean.upper()):
                                if 'SHOP' not in line_clean.upper() and 'WELD' not in line_clean.upper() and 'NOT' not in line_clean.upper() and 'FABRICATOR' not in line_clean.upper():
                                    fields["drawingTitle"] = line_clean
                                    break
                    
                    if not fields["drawingTitle"]:
                        for word in KEYWORDS:
                            if re.search(rf'^\s*{word}\s*$', clean_text, re.M | re.I):
                                fields["drawingTitle"] = word
                                break
                        if not fields["drawingTitle"]:
                            for word in KEYWORDS:
                                if re.search(rf'\b{word}\s+DETAIL\b', clean_text, re.I):
                                    fields["drawingTitle"] = f"{word} DETAIL"
                                    break
                if not fields.get("drawingTitle"):
                    for word in KEYWORDS:
                        if isinstance(word, str) and word.upper() in clean_text.upper():
                            fields["drawingTitle"] = word
                            break

            if fields.get("drawingTitle") and isinstance(fields["drawingTitle"], str):
                if fields["drawingTitle"].upper() in BAD_TITLES:
                    fields["drawingTitle"] = ""
                if fields.get("drawingTitle"):
                    fields["drawingTitle"] = re.sub(r'^(?:DWG\s+)?DESCRIPTION\s*[:.\s]+', '', fields["drawingTitle"], flags=re.I).strip()

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
                if not norm_mark or norm_mark in seen_marks:
                    return
                
                # Validate standard revision mark (Only A, B, C or 0, 1, 2 as requested)
                if not re.match(r'^([A-C0-2])$', norm_mark):
                    return
                    
                # Skip obvious noise tokens
                if norm_mark in ('NO', 'BY', 'OK', 'TO', 'OF', 'IN', 'IS', 'IT',
                                 'DATE', 'MARK', 'ISSUE', 'REVISION', 'COPIES', 'DESTINATION',
                                 '#'):
                    return
                # Skip pure multi-digit numbers that look like counts, not revision marks
                # (revision marks are typically 1 digit or 1-2 letters)
                if len(norm_mark) > 2:
                    return
                seen_marks.add(norm_mark)
                fields["revisionHistory"].append({
                    "mark":    norm_mark,
                    "date":    normalize_date_string(date),
                    "remarks": clean_rem(remarks),
                })

            # ── Phase 1: Structured table extraction ──────────────────────
            # Keywords that identify a "date" column header
            DATE_HDR   = re.compile(r'\bdate\b', re.I)
            # Keywords that identify a "revision/mark" column header
            REV_HDR    = re.compile(r'\b(?:rev(?:ision)?|issue|mark)\b', re.I)
            # Keywords that identify a "description/remarks/destination" header
            DESC_HDR   = re.compile(r'\b(?:desc(?:ription)?|remark|destination|purpose|notes?)\b', re.I)
            # A cell that looks like a valid date (MM-DD-YYYY, DD-MM-YYYY, YYYY-MM-DD, Mon DD YYYY …)
            DATE_CELL  = re.compile(
                r'\b(\d{1,2}[-/\.]\d{1,2}[-/\.]\d{2,4}|\d{4}[-/\.]\d{1,2}[-/\.]\d{1,2}|'
                r'(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,]+\d{1,2}[\s,]+\d{4})\b',
                re.I
            )
            # A cell that looks like a valid revision mark (only A, B, C or 0, 1, 2)
            MARK_CELL  = re.compile(r'^[A-C0-2]$', re.I)

            def _try_table_extraction(pdf_page):
                """
                Use pdfplumber table detection to find the revision history table.

                Handles both orientations:
                  • Header at TOP  → data rows are below  (table[header_idx+1:])
                  • Header at BOTTOM → data rows are above (table[:header_idx])

                Returns True if at least one revision was successfully extracted.
                """
                tables = pdf_page.extract_tables()
                for table in tables:
                    if not table or len(table) < 2:
                        continue

                    # ── Identify header row (check ALL rows, not just first 4) ──
                    header_idx = None
                    col_rev = col_date = col_desc = None

                    for row_i, row in enumerate(table):
                        row_text = [str(c or '').strip() for c in row]
                        # Join multi-line cells (pdfplumber sometimes gives "\nIssue" for "Revision/\nIssue")
                        row_joined = [c.replace('\n', ' ').replace('/', ' ') for c in row_text]
                        has_rev  = any(REV_HDR.search(c) for c in row_joined)
                        has_date = any(DATE_HDR.search(c) for c in row_joined)
                        if has_rev and has_date:
                            header_idx = row_i
                            for ci, cell in enumerate(row_joined):
                                if col_date is None and DATE_HDR.search(cell):
                                    col_date = ci
                                if col_rev is None and REV_HDR.search(cell):
                                    col_rev = ci
                                if col_desc is None and DESC_HDR.search(cell):
                                    col_desc = ci
                            break

                    if header_idx is None or col_rev is None or col_date is None:
                        continue

                    # If no description column found, pick the column that is neither rev nor date
                    all_cols = set(range(len(table[header_idx])))
                    used_cols = {i for i in [col_rev, col_date] if i is not None}
                    if col_desc is None:
                        remaining = sorted(all_cols - used_cols)
                        if remaining:
                            col_desc = remaining[0]

                    # ── Determine data row range ───────────────────────────────
                    # Header at top  → data rows come AFTER it
                    # Header at bottom → data rows come BEFORE it (common in this PDF format)
                    if header_idx == 0:
                        data_rows = table[1:]
                    elif header_idx == len(table) - 1:
                        # Header is the last row — data rows are everything before it
                        data_rows = table[:header_idx]
                    else:
                        # Header is somewhere in the middle.
                        # Check if more data-like rows exist before or after it.
                        rows_after  = table[header_idx + 1:]
                        rows_before = table[:header_idx]
                        after_has_data  = any(
                            DATE_CELL.search(str(r[col_date] or '')) and MARK_CELL.match(str(r[col_rev] or '').strip())
                            for r in rows_after if len(r) > max(col_rev, col_date)
                        )
                        before_has_data = any(
                            DATE_CELL.search(str(r[col_date] or '')) and MARK_CELL.match(str(r[col_rev] or '').strip())
                            for r in rows_before if len(r) > max(col_rev, col_date)
                        )
                        if before_has_data and not after_has_data:
                            data_rows = rows_before
                        else:
                            data_rows = rows_after

                    # ── Parse data rows ───────────────────────────────────────
                    found_any = False
                    min_col = max(c for c in [col_rev, col_date, col_desc or 0] if c is not None)
                    for row in data_rows:
                        if len(row) <= min_col:
                            continue
                        mark    = str(row[col_rev]  or '').strip()
                        date    = str(row[col_date] or '').strip()
                        remarks = str(row[col_desc] or '').strip() if col_desc is not None else ''

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
                # Handles both MM-DD-YYYY and DD-MM-YYYY formats
                rev_rows_new = re.findall(
                    r'^[ \t]*(\d+)[ \t]+([A-C0-2])[ \t]+(.*?)[ \t]+(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})[ \t]*$',
                    clean_text, re.I | re.M
                )
                for r in rev_rows_new:
                    _add_rev(r[1], r[3], r[2])

                # Pattern 2: mark  initials  "Mon DD YYYY"  description
                rev_rows_date_first = re.findall(
                    r'\b([A-C0-2]|REV[ \t][A-C0-2])\b[ \t]+(?:[A-Z]{2,4}[ \t]+)?\b([A-Z]{3,}[ \t]+\d{1,2}[ \t]*,?[ \t]*\d{4})\b[ \t]+(.*)',
                    clean_text, re.I
                )
                for r in rev_rows_date_first:
                    _add_rev(r[0], r[1], r[2])

                # Pattern 3: mark  initials  description  "Mon DD YYYY"
                rev_rows_desc_first = re.findall(
                    r'\b([A-C0-2]|REV[ \t][A-C0-2])\b[ \t]+(?:[A-Z]{2,4}[ \t]+)?(.*?)[ \t]+\b([A-Z]{3,}[ \t]+\d{1,2}[ \t]*,?[ \t]*\d{4})\b(.*)',
                    clean_text, re.I
                )
                for r in rev_rows_desc_first:
                    _add_rev(r[0], r[2], r[1])

                # Pattern 4 (fallback): mark  initials  DD-MM-YYYY or YYYY-MM-DD  description
                if not fields["revisionHistory"]:
                    rev_num = re.findall(
                        r'\b([A-C0-2])\b[ \t]+(?:[A-Z]{2,4}[ \t]+)?(?:.*?)[ \t]*\b(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{4}[-/]\d{1,2}[-/]\d{1,2})\b[ \t]+(.*)',
                        clean_text, re.I
                    )
                    for r in rev_num:
                        _add_rev(r[0], r[1], r[2])

                # Pattern 5 (broad fallback): "A  Issued for Approval  28/01/2026"
                if not fields["revisionHistory"]:
                    rev_broad = re.findall(
                        r'\b([A-C0-2])[ \t]+(Issued[ \t]+for[ \t]+\w+(?:[ \t]+\w+)?)[ \t]+(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})',
                        clean_text, re.I
                    )
                    for r in rev_broad:
                        _add_rev(r[0], r[2], r[1])
                        
                # Pattern 6: DD-MM-YYYY mark description
                if not fields["revisionHistory"]:
                    rev_date_first = re.findall(
                        r'\b(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{4}[-/]\d{1,2}[-/]\d{1,2})\b[ \t]+\b([A-C0-2]|REV[ \t][A-C0-2])\b[ \t]+(.*)',
                        clean_text, re.I
                    )
                    for r in rev_date_first:
                        _add_rev(r[1], r[0], r[2])

            # FLEXIBLE FIELD DETECTION (Keywords & Multi-Region & Destination Mapping)
            if not fields["revisionHistory"]:
                # Try table-like row: # of Copies | Revision | Destination | Date
                # Example: ... GRADE: A36  1 0 FOR FABRICATION 09-22-2025
                row_pattern = re.findall(
                    r'\b(\d+)[ \t]+([A-Z]|\d{1,2})[ \t]+([A-Za-z][A-Za-z\s]*?)[ \t]+(\d{1,2}[-/\.]\d{1,2}[-/\.]\d{2,4})\b',
                    clean_text, re.I
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
                    clean_text, re.I | re.DOTALL
                )
                for r in scattered_pattern:
                    _add_rev(r[0], r[2], r[1].strip())

            if not fields["revisionHistory"]:
                # Individual keyword extraction across entire page
                # Date detection keywords
                date_kw = re.search(r'\b(?:DATE|ISSUE\s+DATE|DRAWING\s+DATE)\s*[:.\-\|]?\s*(\d{1,2}[-/\.]\d{1,2}[-/\.]\d{2,4}|\d{4}[-/\.]\d{1,2}[-/\.]\d{1,2})', clean_text, re.I)
                # Remarks detection keywords
                rem_kw = re.search(r'\b(?:REMARKS|DESTINATION|STATUS)\s*[:.\-\|]?\s*([A-Za-z\s]+?)(?=\s\s+|\n|$)', clean_text, re.I)
                # Revision detection keywords
                rev_kw = re.search(r'\b(?:REV|REVISION|REVISION/ISSUE)\s*[:.\-\|]?\s*([A-Z]|\d{1,2})\b', clean_text, re.I)
                
                if rev_kw or date_kw or rem_kw:
                    r_mark = rev_kw.group(1) if rev_kw else ("0" if date_kw else "0")
                    r_date = date_kw.group(1) if date_kw else ""
                    r_rem = rem_kw.group(1).strip() if rem_kw else ""
                    
                    if r_mark and r_mark not in ('NO', 'BY', 'OK', 'TO', 'OF', 'IN', 'IS', 'IT', 'DATE'):
                         _add_rev(r_mark, r_date, r_rem)

            # Sort chronologically (date ascending) so history is in order
            fields["revisionHistory"].sort(key=get_date_val)

            if fields["revisionHistory"]:
                # ── Pick latest using fabrication-priority rule ──
                latest = pick_latest_revision(fields["revisionHistory"])
                fields["revision"] = latest["mark"]
                fields["date"]     = latest["date"]
                fields["remarks"]  = latest["remarks"]
            else:
                # Absolute fallback: if text OCR was destroyed by vertical text/grids,
                # check if the filename ends in _[REV] or -[REV]. e.g. "06D1005_A.pdf" -> "A"
                rev_match = re.search(r'[_ -]+([A-C0-2])\.pdf$', os.path.basename(pdf_path), re.I)
                if rev_match:
                    rev_candidate = rev_match.group(1).upper()
                    if rev_candidate not in ('ND', 'TH', 'ST'):
                        fields["revision"] = rev_candidate

    except Exception as e:
        fields["description"] = f"Local error: {str(e)}"
    return fields


def extract_locally(pdf_path: str) -> dict:
    # ── Stage 1 & 2: Standard Text Extraction & Table Detection ──
    fields = extract_locally_pass(pdf_path, extraction_mode="layout")
    
    def is_missing_required(f):
        req = ["drawingNumber", "drawingTitle", "revision", "date", "remarks"]
        # If any is totally empty, return True
        return not all(str(f.get(k, "")).strip() for k in req)

    # ── Stage 3: Coordinate Region / Geometric Interleaved Text Pass ──
    if is_missing_required(fields):
        f_geo = extract_locally_pass(pdf_path, extraction_mode="geometric")
        for k in ["drawingNumber", "drawingTitle", "revision", "date", "remarks", "revisionHistory"]:
            if not fields.get(k) and f_geo.get(k):
                fields[k] = f_geo[k]
                
    # ── Stage 4: OCR Fallback ──
    if is_missing_required(fields):
        try:
            f_ocr = extract_locally_pass(pdf_path, extraction_mode="ocr")
            for k in ["drawingNumber", "drawingTitle", "revision", "date", "remarks", "revisionHistory"]:
                if not fields.get(k) and f_ocr.get(k):
                    fields[k] = f_ocr[k]
        except Exception:
            pass
            
    # ── Stage 5: Regex Validation Pass (Raw Layout=False) ──
    if is_missing_required(fields):
        f_raw = extract_locally_pass(pdf_path, extraction_mode="raw")
        for k in ["drawingNumber", "drawingTitle", "revision", "date", "remarks", "revisionHistory"]:
            if not fields.get(k) and f_raw.get(k):
                fields[k] = f_raw[k]

    # Post-process missing spaces
    if fields.get("remarks"):
        r_up = fields["remarks"].upper()
        if r_up == "FORFABRICATION": fields["remarks"] = "FOR FABRICATION"
        elif r_up == "FORAPPROVAL": fields["remarks"] = "FOR APPROVAL"
        elif r_up == "FORCONSTRUCTION": fields["remarks"] = "FOR CONSTRUCTION"

    if fields.get("revisionHistory"):
        for rev_entry in fields["revisionHistory"]:
            entry_up = rev_entry["remarks"].upper()
            if entry_up == "FORFABRICATION": rev_entry["remarks"] = "FOR FABRICATION"
            elif entry_up == "FORAPPROVAL": rev_entry["remarks"] = "FOR APPROVAL"
            elif entry_up == "FORCONSTRUCTION": rev_entry["remarks"] = "FOR CONSTRUCTION"

    return fields


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf_path", help="Path to PDF file")
    parser.add_argument("--api_key", default="", help="Removed - Not Used")
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
