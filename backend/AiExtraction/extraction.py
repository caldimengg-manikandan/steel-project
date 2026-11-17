import re
from datetime import datetime

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

def is_date(s):
    if not s or len(s.strip()) > 18:
        return False
    date_patterns = [
        r'^\d{1,2}[-/\.]\d{1,2}[-/\.]\d{2,4}$',
        r'^\d{2,4}[-/\.]\d{1,2}[-/\.]\d{1,2}$',
        r'^[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4}$',
        r'^\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{2,4}$',
        r'^\d{1,2}[-/\.]\d{1,2}$'
    ]
    s_clean = s.strip()
    return any(re.match(p, s_clean) for p in date_patterns)

def parse_date(date_str):
    if not date_str:
        return datetime.min
    ds = date_str.strip()
    for fmt in ('%b %d %Y', '%m-%d-%Y', '%Y-%m-%d', '%d-%m-%Y', '%m/%d/%Y', '%d/%m/%Y', '%m.%d.%Y', '%d.%m.%Y'):
        try:
            return datetime.strptime(ds, fmt)
        except ValueError:
            pass
    # If MM-DD without year, parse as current year
    m = re.match(r'^(\d{1,2})[-/\.](\d{1,2})$', ds)
    if m:
        try:
            return datetime(datetime.now().year, int(m.group(1)), int(m.group(2)))
        except ValueError:
            pass
    return datetime.min

def is_date_token(t):
    return is_date(t)

def is_remarks_token(t):
    return len(t) >= 3 and not is_date_token(t)

class RowContainer:
    def __init__(self):
        self.date = None
        self.remarks = None
        self.shorts = []

    def can_accept(self, t):
        if is_date_token(t):
            return self.date is None
        elif is_remarks_token(t):
            return self.remarks is None
        else: # short token (e.g. rev mark or row number)
            return len(self.shorts) < 2

    def add(self, t):
        if is_date_token(t):
            self.date = t
        elif is_remarks_token(t):
            self.remarks = t
        else:
            self.shorts.append(t)

def resolve_rev_mark(shorts):
    """
    Resolves the authoritative revision mark from short tokens (<= 2 chars)
    using universal drafting standards (zero hardcoding of specific letters):
    1. Pure punctuation/symbols (e.g. ':', '-', '.', '/') are stripped and discarded.
    2. '0' is always Revision 0 (Issued for Fabrication); engineering row indices are strictly >= 1.
    3. Sequential approval letters (A-G) paired with row index (1, 2, 3...) resolve to the approval letter.
    4. Numeric revisions resolve to the revision number (minimum digit when paired with row index).
    5. Standalone approval letter or alpha token.
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

    digits = [s for s in clean_shorts if s.isdigit()]
    alphas = [s for s in clean_shorts if s.isalpha()]

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

def clean_drawing_no(text, rows=None):
    if not text and not rows:
        return ""
    lines = []
    if rows:
        for r in rows:
            if isinstance(r, list):
                lines.extend([str(c).strip() for c in r if str(c).strip()])
            elif r:
                lines.append(str(r).strip())
    if not lines and text:
        lines = [l.strip() for l in text.split('\n') if l.strip()]

    exclude_headers = {
        'DRAWING NO', 'DRAWING NUMBER', 'DWG NO', 'DWG #', 'SHEET NO', 'SHEET #',
        'DRAWING #', 'DWG', 'SHEET', 'NO.', 'NUMBER', '#', 'DRAWING', 'CONTRACT DWG'
    }
    candidates = []
    for l in lines:
        l_clean = re.sub(r'^(?:CONTRACT\s+)?(?:DRAWING|DWG|SHEET)?\s*(?:NO\.?|NUMBER|#)?\s*[:.\-]*\s*', '', l, flags=re.I).strip()
        if l_clean and l_clean.upper() not in exclude_headers:
            candidates.append(l_clean)
    if candidates:
        return candidates[0]
    elif lines:
        return re.sub(r'^(?:CONTRACT\s+)?(?:DRAWING|DWG|SHEET)?\s*(?:NO\.?|NUMBER|#)?\s*[:.\-]*\s*', '', lines[0], flags=re.I).strip()
    return (text or "").strip()

def clean_project_no(text, rows=None):
    if not text and not rows:
        return "N/A"
    lines = []
    if rows:
        for r in rows:
            if isinstance(r, list):
                lines.extend([str(c).strip() for c in r if str(c).strip()])
            elif r:
                lines.append(str(r).strip())
    if not lines and text:
        lines = [l.strip() for l in text.split('\n') if l.strip()]

    exclude_headers = {
        'PROJECT NO', 'PROJECT NUMBER', 'PROJ NO', 'CONTRACT NO', 'CONTRACT #',
        'PROJ #', 'PROJECT', 'CONTRACT', 'PROJ', 'JOB NO', 'JOB #', 'NO.', '#', 'JOB'
    }

    # 1. Search for explicit project codes/numbers
    for l in lines:
        l_clean = re.sub(r'^(?:PROJECT|CONTRACT|PROJ|JOB)?\s*(?:NO\.?|NUMBER|#)?\s*[:.\-]*\s*', '', l, flags=re.I).strip()
        if l_clean and l_clean.upper() not in exclude_headers:
            m = re.search(r'\b(?:\d{4,7}|[A-Z0-9]{2,6}-\d{2,6})\b', l_clean)
            if m:
                return m.group(0)

    # 2. General non-header candidate
    candidates = []
    for l in lines:
        l_clean = re.sub(r'^(?:PROJECT|CONTRACT|PROJ|JOB)?\s*(?:NO\.?|NUMBER|#)?\s*[:.\-]*\s*', '', l, flags=re.I).strip()
        if l_clean and l_clean.upper() not in exclude_headers and not re.match(r'^(?:DRAWING|TITLE|SHEET)', l_clean, re.I):
            candidates.append(l_clean)
    if candidates:
        return candidates[0]
    return lines[0] if lines else "N/A"

def clean_description_text(text, rows=None):
    if not text and not rows:
        return ""
    lines = []
    if rows:
        for r in rows:
            if isinstance(r, list):
                lines.extend([str(c).strip() for c in r if str(c).strip()])
            elif r:
                lines.append(str(r).strip())
    if not lines and text:
        lines = [l.strip() for l in text.split('\n') if l.strip()]

    header_regex = re.compile(
        r'^(?:DRAWING\s+TITLE|DWG\s+DESCRIPTION|DRAWING\s+DESCRIPTION|DESCRIPTION|TITLE|SHEET\s+TITLE|SHEET\s+NO\.?|DWG\s+NO\.?|DWG\.?|CONTRACT\s+ITEM)\s*[:.\-]*\s*',
        re.I
    )
    exclude_headers = {
        'DRAWING TITLE', 'DWG DESCRIPTION', 'DRAWING DESCRIPTION', 'DESCRIPTION', 'TITLE', 
        'SHEET TITLE', 'SHEET NO', 'DWG NO', 'DWG', 'SHEET', 'DRAWING', 'CONTRACT ITEM', 'NO.'
    }

    cleaned = []
    for l in lines:
        stripped = header_regex.sub('', l).strip()
        if not stripped:
            continue
        if stripped.upper() in exclude_headers:
            continue
        if re.match(r'^(?:SCALE|DATE|REV)\s*[:\-]', stripped, re.I):
            continue
        if stripped.isdigit() and len(stripped) <= 3:
            continue
        cleaned.append(stripped)

    if cleaned:
        return " \n ".join(cleaned).strip()
    fallback = [l.strip() for l in lines if l.strip() and not header_regex.match(l)]
    return " \n ".join(fallback).strip() if fallback else (text or "").strip()

def process_extracted_data(detections):
    """
    Processes raw detections into structured data using robust token & container
    logic similar to SteelFab and IronFab pipelines.
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

    # 1. Filter to keep only the highest confidence detection for each label/class
    best_detections = {}
    for det in detections:
        label = det.get("label", "")
        if not label:
            continue
        conf = det.get("confidence", 0.0)
        if label not in best_detections or conf > best_detections[label].get("confidence", 0.0):
            best_detections[label] = det

    # 2. Process each detection
    for det in best_detections.values():
        label = det.get("label", "")
        text = det.get("text", "")
        rows = det.get("rows", [])

        if label == "DRAWING_NO":
            drawing_no = clean_drawing_no(text, rows)
            
        elif label == "PROJECT_NO":
            project_no = clean_project_no(text, rows)

        elif label == "DRAWING_DESCRIPTION":
            drawing_description = clean_description_text(text, rows)

        elif label == "REVISION_TABLE":
            # 1. Collect all raw tokens from rows/text
            all_tokens = []
            if rows:
                for r in rows:
                    if r:
                        for cell in r:
                            if isinstance(cell, str):
                                all_tokens.extend([t.strip() for t in cell.split('\n') if t.strip()])
            elif text:
                all_tokens = [t.strip() for t in text.split('\n') if t.strip()]

            # 2. Filter out header noise and draftsman initials
            remove_keywords_rev = [
                "#", "# OF", "COPIES", "# OF COPIES", "REVISION", "ISSUE", "REVISION/ISSUE", 
                "DESTINATION", "DATE", "REVISION/", "SENT FOR", "FABRICATION", "SENT FOR FABRICATION",
                "REVISION HISTORY", "HISTORY", "BY", "APP'D", "CHKD", "DWN", "DESCRIPTION", "DESC"
            ]

            filtered_tokens = []
            for t in all_tokens:
                if not any(c.isalnum() for c in t):
                    continue
                tu = t.upper().strip()
                is_header = False
                for kw in remove_keywords_rev:
                    if kw == tu or tu.startswith(kw + " "):
                        is_header = True
                        break
                if not is_header:
                    clean_t = tu.replace(".", "").strip()
                    is_initials = clean_t.isalpha() and 2 <= len(clean_t) <= 3 and not is_date_token(t)
                    if not is_initials:
                        filtered_tokens.append(t)

            # 3. Dynamic row grouping using RowContainer
            containers = []
            current_container = None

            for t in filtered_tokens:
                if current_container is None:
                    current_container = RowContainer()
                elif not current_container.can_accept(t):
                    containers.append(current_container)
                    current_container = RowContainer()
                current_container.add(t)
            if current_container:
                containers.append(current_container)

            # 4. Resolve revision mark, date, and remarks for each container
            for c in containers:
                remarks = clean_remarks(c.remarks or "")
                date_val = c.date or ""
                rev = resolve_rev_mark(c.shorts)

                if rev or date_val or remarks:
                    revisions.append({
                        "rev": rev,
                        "date": date_val,
                        "remarks": remarks
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

    # Remove drawing number if it leaked into drawing description
    if drawing_no and drawing_description:
        drawing_description = drawing_description.replace(drawing_no, "").strip()
        drawing_description = " \n ".join([line.strip() for line in drawing_description.split('\n') if line.strip()])

    return {
        "project_no": project_no,
        "drawing_no": drawing_no,
        "drawing_description": drawing_description,
        "revisions": revisions,
        "latest_revision": latest_revision
    }
