import re
from datetime import datetime

def is_date(s):
    date_patterns = [
        r'\d{1,2}-\d{1,2}-\d{2,4}',        # 04-09-2026, 4-9-26
        r'\d{2,4}-\d{1,2}-\d{1,2}',        # 2026-04-09
        r'[A-Za-z]{3}\s+\d{1,2}\s+\d{2,4}', # Mar 15 2025, Apr 3 25
        r'\d{1,2}/\d{1,2}/\d{2,4}',        # 04/09/2026
        r'\d{1,2}\.\d{1,2}\.\d{2,4}'       # 04.09.2026
    ]
    for p in date_patterns:
        if re.search(p, s):
            return True
    return False

def parse_date(date_str):
    """Parses date string into a sortable object (datetime)."""
    if not date_str:
        return datetime.min
    
    # Try common formats
    formats = ["%b %d %Y", "%m-%d-%Y", "%Y-%m-%d", "%d-%m-%Y", "%m/%d/%Y", "%d/%m/%Y"]
    for fmt in formats:
        try:
            return datetime.strptime(date_str.strip(), fmt)
        except ValueError:
            continue
    
    # Simple regex fallback if standard parsing fails
    try:
        match = re.search(r'(\d+)', date_str)
        if match:
            return datetime(int(match.group(1)), 1, 1) # Just use year if found
    except:
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
        else: # short token (length <= 2)
            return len(self.shorts) < 2

    def add(self, t):
        if is_date_token(t):
            self.date = t
        elif is_remarks_token(t):
            self.remarks = t
        else:
            self.shorts.append(t)

def process_extracted_data(detections):
    """
    Processes the raw detections from inference.py into structured data
    specifically tailored for IronFab drawings.
    """
    result = {
        "project_no": "N/A",
        "drawing_no": "",
        "drawing_description": "",
        "revisions": []
    }

    # If detections is empty or there was an error
    if not isinstance(detections, list):
        return result

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
        label = det.get("label")
        text = det.get("text", "")
        rows = det.get("rows", [])

        if label == "PROJECT_NO":
            lines = [l.strip() for l in text.split('\n') if l.strip()]
            for l in lines:
                if re.match(r'^\d{5,6}$', l):
                    result["project_no"] = l
                    break

        elif label == "DRAWING_NO":
            # Exclude keywords like DRAWING, NO, #, DWG
            exclude_kws = ["DRAWING", "NO", "#", "DWG"]
            lines = []
            for l in text.split('\n'):
                l_strip = l.strip()
                if not l_strip:
                    continue
                l_upper = l_strip.upper()
                keep = True
                for kw in exclude_kws:
                    if kw in l_upper:
                        keep = False
                        break
                if keep:
                    lines.append(l_strip)
            if lines:
                result["drawing_no"] = lines[0]
            else:
                result["drawing_no"] = text.strip()
            
        elif label == "DRAWING_DESCRIPTION":
            # Exclude static title block keywords like Drawing Title:, Dwg, Description
            exclude_kws = ["DRAWING", "TITLE", "DWG", "DESCRIPTION", "NO.", "Contract Item:", "contract item:","contract","item", "SHEET", "SHEET NO.", "SHEET NO", "SHEET NO:"]
            lines = []
            for l in text.split('\n'):
                l_strip = l.strip()
                if not l_strip:
                    continue
                l_upper = l_strip.upper()
                keep = True
                for kw in exclude_kws:
                    if kw in l_upper:
                        keep = False
                        break
                if keep:
                    lines.append(l_strip)
            if lines:
                result["drawing_description"] = " ".join(reversed(lines))
            else:
                # If everything gets filtered out, fallback to first non-empty line that doesn't strictly match the static label
                fallback_lines = [l.strip() for l in text.split('\n') if l.strip()]
                filtered_fallback = [l for l in fallback_lines if "Drawing Title" not in l and "Title" not in l]
                if filtered_fallback:
                    result["drawing_description"] = filtered_fallback[0]
                elif fallback_lines:
                    result["drawing_description"] = fallback_lines[0]
                else:
                    result["drawing_description"] = text.strip()
                
        elif label == "REVISION_TABLE" and rows:
            # 1. Collect all raw tokens from rows
            all_tokens = []
            for r in rows:
                if r:
                    for cell in r:
                        if isinstance(cell, str):
                            all_tokens.extend([t.strip() for t in cell.split('\n') if t.strip()])
            
            # 2. Filter out header noise and draft initials
            remove_keywords_rev = [
                "#", "# of", "Copies", "# of Copies", "Revision", "Issue", "Revision/Issue", 
                "Destination", "Date", "REVISION/", "SENT FOR", "FABRICATION", "SENT FOR FABRICATION",
                "REVISION HISTORY", "HISTORY", "BY", "APP'D", "CHKD", "DWN"
            ]
            
            filtered_tokens = []
            for t in all_tokens:
                tu = t.upper().strip()
                is_header = False
                for kw in remove_keywords_rev:
                    if kw.upper() == tu or tu.startswith(kw.upper()):
                        is_header = True
                        break
                if not is_header:
                    clean_t = tu.replace(".", "").strip()
                    is_initials = clean_t.isupper() and clean_t.isalpha() and len(clean_t) == 3
                    if not is_initials:
                        filtered_tokens.append(t)
                        
            # 3. Dynamic row grouping using Container
            containers = []
            current_container = None
            
            for t in filtered_tokens:
                if current_container is None:
                    current_container = RowContainer()
                    current_container.add(t)
                else:
                    if current_container.can_accept(t):
                        current_container.add(t)
                    else:
                        containers.append(current_container)
                        current_container = RowContainer()
                        current_container.add(t)
            if current_container:
                containers.append(current_container)
                
            # 4. Resolve revision mark and index for each container
            for c in containers:
                rev = "0"
                remarks = c.remarks or ""
                date_val = c.date or ""
                
                shorts = c.shorts
                if len(shorts) == 1:
                    rev = shorts[0]
                elif len(shorts) == 2:
                    s1, s2 = shorts[0], shorts[1]
                    if s1.isalpha() and s2.isdigit():
                        rev = s1
                    elif s2.isalpha() and s1.isdigit():
                        rev = s2
                    elif s1.isdigit() and s2.isdigit():
                        d1, d2 = int(s1), int(s2)
                        # Revision mark is the smaller digit, index is the larger
                        if d1 < d2:
                            rev = s1
                        else:
                            rev = s2
                    else:
                        rev = s1
                        
                # Clean up "ISS" OCR misreads
                if remarks and not re.search(r'ISS', remarks, re.IGNORECASE) and ('1SS' in remarks or 'lSS' in remarks):
                    remarks = re.sub(r'1SS', 'ISS', remarks, flags=re.IGNORECASE)
                    remarks = re.sub(r'lSS', 'ISS', remarks, flags=re.IGNORECASE)
                    
                # We require at least a revision mark, date or remarks to be a valid row
                if rev or date_val or remarks:
                    result["revisions"].append({
                        "rev": rev,
                        "date": date_val,
                        "remarks": remarks
                    })

    # Sort revisions by date (newest first)
    if result["revisions"]:
        result["revisions"].sort(key=lambda x: parse_date(x["date"]), reverse=True)
        result["latest_revision"] = result["revisions"][0]
    else:
        result["latest_revision"] = {
            "rev": "0",
            "date": "",
            "remarks": "ISSUED FOR CONSTRUCTION"
        }
        
    drawing_no = result.get("drawing_no", "")
    drawing_description = result.get("drawing_description", "")
    if drawing_no and drawing_description:
        drawing_description = drawing_description.replace(drawing_no, "").strip()
        result["drawing_description"] = " \n ".join([line.strip() for line in drawing_description.split('\n') if line.strip()])

    return result
