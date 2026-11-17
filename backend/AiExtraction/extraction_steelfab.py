import re
from datetime import datetime

def is_col3(t):
    # validate Date format: MM-DD-YYYY, etc.
    # Also support textual dates like "May 7 2025", "May 7, 2025", "May 07 2025"
    patterns = [
        r'\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}',
        r'[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4}'
    ]
    for p in patterns:
        if re.search(p, t, re.IGNORECASE):
            return True
    return False

def is_col0(t):
    # numbers [1 to N number]
    return t.isdigit()

def is_col1(t):
    # any number or any alphabet max of two digit or character
    return (t.isdigit() or t.isalpha()) and len(t) <= 2

def is_col2(t):
    # a sentences or a word - atleast 3 character
    return len(t) >= 3 and not is_col3(t)

def parse_date(date_str):
    if not date_str:
        return datetime.min
    
    # Try textual format first (e.g. "May 7 2025" or "May 7, 2025")
    match_text = re.search(r'([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{2,4})', date_str)
    if match_text:
        month_str, day_str, year_str = match_text.groups()
        if len(year_str) == 2:
            year_str = "20" + year_str
        date_normalized = f"{month_str} {day_str} {year_str}"
        for fmt in ('%b %d %Y', '%B %d %Y', '%b %d, %Y', '%B %d, %Y'):
            try:
                return datetime.strptime(date_normalized, fmt)
            except ValueError:
                pass
                
    # Try numeric formats
    match = re.search(r'\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}', date_str)
    if not match: 
        return datetime.min
    ds = match.group()
    for fmt in ('%m-%d-%Y', '%d-%m-%Y', '%Y-%m-%d', '%m/%d/%Y', '%d/%m/%Y'):
        try:
            return datetime.strptime(ds, fmt)
        except ValueError:
            pass
    return datetime.min

def clean_remarks(text):
    if not text:
        return ""
    s = str(text).strip()
    s = re.sub(r'^(?:[xX*\-.\s]+|[vV]\s+)(?=[A-Z0-9])', '', s).strip()
    changed = True
    while changed:
        orig = s
        # 1. Field labels like 'DETAILED BY :', 'CHECKED BY :', 'BY :'
        s = re.sub(r'^(?:[A-Za-z\s\'’]{1,20}\bBY\s*[:\-])\s*', '', s, flags=re.I).strip()
        # 2. Standard column headers
        s = re.sub(r'^(?:DATE|CHKD|DWN|REV(?:ISION)?(?:\s*#|\s*\d+)?|MARK|NO|SHEET|TITLE)\s*[:\-]\s*(?:[A-Za-z0-9]{1,4}\b(?!\s*[-/\.]|\s*[A-Z]{3,})\s*)?', '', s, flags=re.I).strip()
        # 3. Standalone initials or mark followed by a colon or dash
        s = re.sub(r'^[A-Za-z0-9]{1,4}\s*[:\-]\s*', '', s).strip()
        # 4. Initials followed immediately by a date
        s = re.sub(r'^[A-Za-z0-9]{1,4}\s+(?=\d{1,2}\s*[-/\.]\d{1,2})', '', s).strip()
        # 5. Date at start (MM-DD, MM/DD/YYYY, etc.)
        s = re.sub(r'^\d{1,2}\s*[-/\.]\s*\d{1,2}(?:\s*[-/\.]\s*(?:20\d{2}|19\d{2}|\d{2}))?\s*', '', s).strip()
        # 6. Initials or rev mark followed by standard remark keywords
        s = re.sub(r'^[A-Za-z0-9]{1,4}\s+(?=(?:ISSUED|REVISED|FOR|APPROVED?|PRELIMINARY|SUBMITTED|BID|CONSTRUCTION|RELEASED|CHECKED|RECORD|AS[\s\-]BUILT)\b)', '', s, flags=re.I).strip()
        # 7. Initials that follow a date or colon
        s = re.sub(r'^[A-Za-z0-9]{1,4}\s*[:\-]\s*', '', s).strip()
        # 8. Leading punctuation
        s = re.sub(r'^[:.\-\s/]+', '', s).strip()
        changed = (s != orig)

    # Clean trailing noise like 'DWN BY: MSN'
    s = re.sub(r'\s+\b(?:(?:DRAWN|CHECKED|DETAILED|APP\'?D?|CHKD|DWN)\s+BY|DRAWN|CHKD|DWN|DATE|REV\s*#)\b\s*[:\-]?(?:\s+[A-Za-z0-9]{1,4})?\s*$', '', s, flags=re.I).strip()
    s = re.sub(r'[:.\-\s/]+$', '', s).strip()
    s = re.sub(r'\s+', ' ', s).strip()
    return s

def resolve_rev_mark(shorts):
    """
    Resolves the authoritative revision mark from short tokens (<= 2 chars)
    using universal drafting standards (zero hardcoding of specific letters):
    1. Pure punctuation/symbols (e.g. ':', '-', '.', '/') are stripped and discarded.
    2. '0' is always Revision 0 (Issued for Fabrication); engineering row indices are strictly >= 1.
    3. Alpha revision marks (e.g. A, B, C... S, etc.) paired with row index (1, 2, 3...) resolve to the alpha mark.
    4. Numeric revisions resolve to the revision number (minimum digit when paired with row index).
    5. Standalone alpha token (including 'S' or any letter).
    6. Defaults cleanly to '0' if no alphanumeric characters exist.
    """
    if not shorts:
        return '0'

    clean_shorts = []
    for s in shorts:
        sc = re.sub(r'[^A-Za-z0-9]', '', str(s)).strip()
        if sc:
            clean_shorts.append(sc)

    if not clean_shorts:
        return '0'

    ignore_tokens = {'REV', 'BY', 'NO', 'DWN', 'CHK', 'APP'}
    clean_shorts = [s for s in clean_shorts if s.upper() not in ignore_tokens]
    if not clean_shorts:
        return '0'

    digits = [s for s in clean_shorts if s.isdigit()]
    alphas = [s.upper() for s in clean_shorts if s.isalpha()]

    # Universal Rule: '0' is always Revision 0 (never a 1-based table row index)
    if '0' in digits:
        return '0'

    # Alpha revision mark (len 1-2, e.g. A, B, S, AA) paired with row index (1, 2, 3...)
    short_alphas = [a for a in alphas if len(a) <= 2]
    if short_alphas and digits:
        return short_alphas[0]

    # Numeric revisions (if digits exist, the revision number is the digit)
    if digits:
        d_ints = [int(d) for d in digits]
        return str(min(d_ints))

    # Standalone alpha revision (A, B, S, etc.)
    if short_alphas:
        return short_alphas[0]

    if alphas:
        return alphas[0]

    return clean_shorts[0]

def assign_token(row_dict, t):
    if is_col3(t):
        if 3 in row_dict: return False
        row_dict[3] = t
        return True
    
    if is_col2(t):
        if 2 in row_dict: return False
        cleaned = clean_remarks(t)
        if cleaned:
            row_dict[2] = cleaned
            return True

    if is_col0(t) and 0 not in row_dict:
        row_dict[0] = t
        return True
    
    if is_col1(t) and 1 not in row_dict:
        row_dict[1] = t
        return True
        
    return False

def process_revision_table(rows):
    if not rows: return rows
    
    remove_keywords_rev = ["#", "# of", "Copies", "# of Copies", "Revision", "Issue", "Revision/Issue", "Destination", "Date", "REVISION/"]
    
    all_tokens = []
    for row in rows:
        for cell in row:
            all_tokens.extend([t.strip() for t in cell.split('\n') if t.strip()])
            
    filtered_tokens = []
    for t in all_tokens:
        tu = t.upper().strip()
        is_header = False
        for kw in remove_keywords_rev:
            if kw.upper() == tu:
                is_header = True
                break
        if not is_header:
            # Clean and filter out draftsman initials like KMA (length 3 uppercase alpha)
            clean_t = tu.replace(".", "").strip()
            is_initials = clean_t.isupper() and clean_t.isalpha() and len(clean_t) == 3
            if not is_initials:
                filtered_tokens.append(t)
            
    final_rows = []
    row_dict = {}
    for t in filtered_tokens:
        assigned = assign_token(row_dict, t)
        if not assigned:
            if row_dict:
                final_rows.append([row_dict.get(0, ""), row_dict.get(1, ""), row_dict.get(2, ""), row_dict.get(3, "")])
                row_dict = {}
                assign_token(row_dict, t)
                
    if row_dict:
        final_rows.append([row_dict.get(0, ""), row_dict.get(1, ""), row_dict.get(2, ""), row_dict.get(3, "")])
        
    # Sort the Rows according to the latest date
    final_rows.sort(key=lambda x: parse_date(x[3]), reverse=True)
    
    return final_rows

def process_simple_field(rows, keywords):
    if not rows: return rows
    new_rows = []
    for row in rows:
        keep = True
        for cell in row:
            cu = cell.upper().strip()
            for kw in keywords:
                if kw.upper() in cu:
                    keep = False
                    break
            if not keep: break
        if keep:
            new_rows.append(row)
    return new_rows

def clean_description_text(rows):
    if not rows:
        return ""
    cleaned_lines = []
    header_regex = re.compile(
        r'^(?:DRAWING\s+TITLE|DWG\s+DESCRIPTION|DRAWING\s+DESCRIPTION|DESCRIPTION|TITLE|SHEET\s+TITLE|SHEET\s+NO\.?|DWG\s+NO\.?|DWG\.?|NO\.?)\s*[:.\-]*\s*',
        re.IGNORECASE
    )
    for row in rows:
        line_str = " ".join(row).strip()
        if not line_str:
            continue
        stripped_line = header_regex.sub('', line_str).strip()
        if stripped_line.upper() in ["DRAWING TITLE", "DWG DESCRIPTION", "DESCRIPTION", "TITLE", "SHEET", "DRAWING", "DWG"]:
            continue
        if stripped_line:
            cleaned_lines.append(stripped_line)
    return " \n ".join(cleaned_lines).strip()

def process_extracted_data(detections):
    """
    Processes raw detections into structured data for Steelfab.
    """
    project_no = "N/A"
    drawing_no = ""
    drawing_description = ""
    revisions = []

    if not isinstance(detections, list):
        return {
            "project_no": project_no,
            "drawing_no": drawing_no,
            "drawing_description": drawing_description,
            "revisions": revisions,
            "latest_revision": {
                "rev": "0",
                "date": "",
                "remarks": "ISSUED FOR FABRICATION"
            }
        }

    # Filter to keep only the highest confidence detection for each label/class
    best_detections = {}
    for det in detections:
        label = det.get("label", "")
        if not label:
            continue
        conf = det.get("confidence", 0.0)
        if label not in best_detections or conf > best_detections[label].get("confidence", 0.0):
            best_detections[label] = det

    for det in best_detections.values():
        label = det.get("label", "")
        rows = det.get("rows", [])
        if not rows:
            continue
            
        if label == "DRAWING_NO":
            cleaned_rows = process_simple_field(rows, ["Drawing", "#", "Drawing #", "NO.", "DWG"])
            if cleaned_rows:
                drawing_no = " ".join(cleaned_rows[0])
        elif label == "PROJECT_NO":
            cleaned_rows = process_simple_field(rows, ["Contract", "#", "Contract #", "NO.", "PROJ."])
            cleaned_rows = process_simple_field(cleaned_rows, ["Drawing", "Title", "Drawing Title:"])
            if cleaned_rows:
                project_no = " ".join(cleaned_rows[0])
        elif label == "DRAWING_DESCRIPTION":
            drawing_description = clean_description_text(rows)
        elif label == "REVISION_TABLE":
            cleaned_rows = process_revision_table(rows)
            for row in cleaned_rows:
                if len(row) >= 4:
                    col0, col1, col2, col3 = row[0], row[1], row[2], row[3]
                    shorts = [s for s in [col0, col1] if s]
                    rev_val = resolve_rev_mark(shorts)
                    revisions.append({
                        "rev": rev_val,
                        "date": col3,
                        "remarks": clean_remarks(col2)
                    })

    # Sort revisions by date (newest first)
    revisions.sort(key=lambda x: parse_date(x["date"]), reverse=True)
    
    if revisions:
        latest_revision = revisions[0]
    else:
        latest_revision = {
            "rev": "0",
            "date": "",
            "remarks": "ISSUED FOR FABRICATION"
        }
    if drawing_no and drawing_description:
        drawing_description = drawing_description.replace(drawing_no, "").strip()
        drawing_description = " \n ".join([line.strip() for line in drawing_description.split('\n') if line.strip()])

    if re.search(r'\.(pdf|nc1|dwg|dxf)$', drawing_description, re.I) or re.search(r'_\d+$', drawing_description, re.I):
        drawing_description = ""

    return {
        "project_no": project_no,
        "drawing_no": drawing_no,
        "drawing_description": drawing_description,
        "revisions": revisions,
        "latest_revision": latest_revision
    }
