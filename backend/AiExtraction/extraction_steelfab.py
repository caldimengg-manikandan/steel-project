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

def assign_token(row_dict, t):
    if is_col3(t):
        if 3 in row_dict: return False
        row_dict[3] = t
        return True
    
    if is_col2(t):
        if 2 in row_dict: return False
        row_dict[2] = t
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
            cleaned_rows = process_simple_field(rows, ["Drawing", "Title", "Drawing Title:", "NO.", "DWG", "DESCRIPTION"])
            if cleaned_rows:
                drawing_description = " \n ".join([" ".join(r) for r in cleaned_rows]).strip()
        elif label == "REVISION_TABLE":
            cleaned_rows = process_revision_table(rows)
            for row in cleaned_rows:
                if len(row) >= 4:
                    col0, col1, col2, col3 = row[0], row[1], row[2], row[3]
                    rev_val = col1 if col1 else col0
                    revisions.append({
                        "rev": rev_val,
                        "date": col3,
                        "remarks": col2
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
        
    return {
        "project_no": project_no,
        "drawing_no": drawing_no,
        "drawing_description": drawing_description,
        "revisions": revisions,
        "latest_revision": latest_revision
    }
