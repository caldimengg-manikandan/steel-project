import re
from datetime import datetime

def is_date(s):
    if not s:
        return False
    date_patterns = [
        r'[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4}',  # Aug 14 2025, Sep 24 2025
        r'\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}',      # 09-24-2025, 09/24/2025
        r'\d{4}[-/.]\d{1,2}[-/.]\d{1,2}',        # 2025-09-24
    ]
    for p in date_patterns:
        if re.search(p, s.strip(), re.IGNORECASE):
            return True
    return False

def parse_date(date_str):
    """Parses date string into a sortable datetime object."""
    if not date_str:
        return datetime.min
    
    # Textual format: e.g. "Aug 14 2025" or "Sep 24, 2025"
    match_text = re.search(r'([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{2,4})', date_str)
    if match_text:
        month_str, day_str, year_str = match_text.groups()
        if len(year_str) == 2:
            year_str = "20" + year_str
        date_normalized = f"{month_str[:3].title()} {int(day_str):02d} {year_str}"
        try:
            return datetime.strptime(date_normalized, "%b %d %Y")
        except ValueError:
            pass

    formats = [
        "%m-%d-%Y", "%m/%d/%Y", "%m.%d.%Y",
        "%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y",
        "%Y-%m-%d", "%Y/%m/%d"
    ]
    for fmt in formats:
        try:
            return datetime.strptime(date_str.strip(), fmt)
        except ValueError:
            continue

    try:
        match = re.search(r'(\d{4})', date_str)
        if match:
            return datetime(int(match.group(1)), 1, 1)
    except:
        pass
        
    return datetime.min

def parse_revision_tokens(tokens):
    """
    Parses a list of cleaned revision tokens into a list of revision dicts.
    Each revision has rev, date, remarks.
    """
    revisions = []
    
    # We identify date tokens as anchor points
    # Typically in Rast Iron Works: [rev, remarks, (initials), date]
    # or [rev, remarks, date]
    current_rev = None
    current_remarks = None
    
    for t in tokens:
        t_clean = t.strip()
        if not t_clean:
            continue
            
        if is_date(t_clean):
            # We reached a date: finalize this revision entry
            revisions.append({
                "rev": current_rev if current_rev is not None else "0",
                "date": t_clean,
                "remarks": current_remarks or ""
            })
            current_rev = None
            current_remarks = None
        elif len(t_clean) <= 2 and current_rev is None and not current_remarks:
            # Candidate for rev mark (e.g. '0', '1', 'A', 'B')
            current_rev = t_clean
        elif len(t_clean) >= 4 and not current_remarks:
            # Candidate for remarks (e.g. 'ISSUED FOR APPROVAL')
            current_remarks = t_clean
        elif current_remarks and len(t_clean) >= 3 and not is_date(t_clean):
            # Append multi-line remarks if not yet at date
            current_remarks = f"{current_remarks} {t_clean}"
            
    return revisions

def process_rastiron_data(detections):
    """
    Processes raw detections from inference.py for Rast Iron Works drawings.
    Extracts:
      - project_no: Project number (e.g. '25009')
      - drawing_no: Sheet / drawing number (e.g. '1M1', '4B1')
      - drawing_description: Job / drawing description (e.g. 'EMBED PLATE')
      - revisions: list of {rev, date, remarks}
      - latest_revision: most recent revision entry
    """
    result = {
        "project_no": "N/A",
        "drawing_no": "",
        "drawing_description": "",
        "revisions": []
    }

    if not isinstance(detections, list):
        return result

    best_detections = {}
    for det in detections:
        label = det.get("label", "")
        if not label:
            continue
        conf = det.get("confidence", 0.0)
        if label not in best_detections or conf > best_detections[label].get("confidence", 0.0):
            best_detections[label] = det

    for det in best_detections.values():
        label = det.get("label")
        text = det.get("text", "")
        rows = det.get("rows", [])

        # -------------------------------------------------------------
        # PROJECT_NO
        # -------------------------------------------------------------
        if label == "PROJECT_NO":
            # First search for standard 5 or 6 digit number (e.g. 25009)
            match = re.search(r'\b(\d{5,6})\b', text)
            if match:
                result["project_no"] = match.group(1)
            else:
                lines = [l.strip() for l in text.split('\n') if l.strip()]
                clean_lines = [
                    l for l in lines 
                    if not re.search(r'^(PROJECT|NO|\#|SHEET|SHEET\s*NO)[\.:\s]*$', l, re.IGNORECASE)
                ]
                if clean_lines:
                    result["project_no"] = clean_lines[0]

        # -------------------------------------------------------------
        # DRAWING_NO
        # -------------------------------------------------------------
        elif label == "DRAWING_NO":
            exclude_exact = {"SHEET", "SHEET NO", "SHEET NO.", "SHEET NO:", "DRAWING", "DWG", "NO", "NO.", "#", "."}
            candidates = []
            for l in text.split('\n'):
                l_strip = l.strip()
                if not l_strip:
                    continue
                l_upper = l_strip.upper()
                if l_upper in exclude_exact or re.match(r'^(SHEET|DRAWING|DWG)\s*(NO|NUMBER)?[\.:\s]*$', l_upper):
                    continue
                # Remove static prefixes like "SHEET NO."
                cleaned = re.sub(r'^(SHEET\s*NO[\.:\s]*|DWG\s*NO[\.:\s]*|NO[\.:\s]*)', '', l_strip, flags=re.IGNORECASE).strip()
                # Filter out lone punctuation or stray 0 if preceded/followed by sheet number
                if cleaned and cleaned not in [".", "-", "_"]:
                    candidates.append(cleaned)

            if candidates:
                # Rast Iron Works sheet numbers are typically alphanumeric like 1M1, 4B1, 3AB1
                preferred = [c for c in candidates if re.search(r'[A-Za-z]', c) and re.search(r'\d', c)]
                if preferred:
                    result["drawing_no"] = preferred[0]
                else:
                    result["drawing_no"] = candidates[0]
            else:
                result["drawing_no"] = text.strip()

        # -------------------------------------------------------------
        # DRAWING_DESCRIPTION
        # -------------------------------------------------------------
        elif label == "DRAWING_DESCRIPTION":
            exclude_keywords = [
                "CUSTOMER", "LOCATION", "ARCH /ENGR", "ARCH/ENGR", "ARCH", "ENGR",
                "ARCHITECT", "ENGINEER", "CONTRACTOR", "GENERAL CONTRACTOR",
                "PROJECT", "TITLE", "DESCRIPTION", "DWG", "SHEET", "NO.", "DATE"
            ]
            lines = []
            for l in text.split('\n'):
                l_strip = l.strip()
                if not l_strip:
                    continue
                l_upper = l_strip.upper()
                is_ex = False
                for kw in exclude_keywords:
                    if l_upper == kw or l_upper.startswith(kw + ":") or l_upper.startswith(kw + " "):
                        is_ex = True
                        break
                if not is_ex:
                    lines.append(l_strip)

            if lines:
                result["drawing_description"] = " ".join(lines)
            else:
                result["drawing_description"] = text.strip()

        # -------------------------------------------------------------
        # REVISION_TABLE
        # -------------------------------------------------------------
        elif label == "REVISION_TABLE":
            # Collect tokens from text / rows
            raw_tokens = []
            if rows:
                for r in rows:
                    if r:
                        for cell in r:
                            if isinstance(cell, str):
                                raw_tokens.extend([t.strip() for t in cell.split('\n') if t.strip()])
            else:
                raw_tokens = [t.strip() for t in text.split('\n') if t.strip()]

            # Header words & typos (e.g. "DESCRIPTON") to discard
            header_keywords = [
                "REV", "REVISION", "DESCRIPTION", "DESCRIPTON", "REVISION DESCRIPTION", "REVISION DESCRIPTON",
                "REV/BY", "REV / BY", "BY", "DATE", "DWN", "CHKD", "APP'D", "APPROVED", "DRAWN"
            ]

            filtered_tokens = []
            for t in raw_tokens:
                tu = t.upper().strip()
                # Check if it matches any header keyword
                if tu in header_keywords:
                    continue
                if any(tu == h or tu.startswith(h + " ") or tu.startswith(h + "/") for h in header_keywords):
                    continue
                # Discard draftsman initials (e.g. MSN, JKL, MHH)
                clean_t = tu.replace(".", "").strip()
                if clean_t.isalpha() and 2 <= len(clean_t) <= 3 and not is_date(t):
                    continue
                filtered_tokens.append(t)

            parsed_revs = parse_revision_tokens(filtered_tokens)
            result["revisions"].extend(parsed_revs)

    # Sort revisions by date (newest first)
    if result["revisions"]:
        result["revisions"].sort(key=lambda x: parse_date(x["date"]), reverse=True)
        result["latest_revision"] = result["revisions"][0]
    else:
        result["latest_revision"] = {
            "rev": "0",
            "date": "",
            "remarks": "ISSUED FOR FABRICATION"
        }

    # Clean description by removing drawing_no if present
    drawing_no = result.get("drawing_no", "")
    drawing_desc = result.get("drawing_description", "")
    if drawing_no and drawing_desc:
        result["drawing_description"] = re.sub(rf'\b{re.escape(drawing_no)}\b', '', drawing_desc).strip()

    return result
