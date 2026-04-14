import re
import os
import pdfplumber

def extract_locally(pdf_path: str) -> dict:
    fields = {
        "drawingNumber": "",
        "drawingTitle": "",
        "description": "Locally extracted (No AI Key)",
        "drawingDescription": "",
        "revision": "0",
        "date": "",
        "scale": "",
        "clientName": "",
        "projectName": "",
        "remarks": "",
        "revisionHistory": []
    }

    try:
        with pdfplumber.open(pdf_path) as pdf:
            page = pdf.pages[0]
            text = page.extract_text()
            if not text:
                 return fields
            
            # 1. Drawing Number
            dn_match = re.search(r'DWG\s+NO\s*[:.]*\s*(\S+)', text, re.I)
            if not dn_match:
                 dn_match = re.search(r'pl\d+[A-Z\d]*', text, re.I)
            bk_dn = os.path.basename(pdf_path).split("_")[-2] if "_" in pdf_path else os.path.basename(pdf_path).replace(".pdf","")
            fields["drawingNumber"] = dn_match.group(1) if dn_match and hasattr(dn_match, 'group') else (dn_match.group(0) if dn_match else bk_dn)

            # 2. Drawing Title
            title_match = re.search(r'DWG\s+DESCRIPTION\s*:\s*(.*)', text, re.I)
            if title_match:
                fields["drawingTitle"] = title_match.group(1).split("\n")[0].strip()
            elif "PLATE" in text.upper():
                fields["drawingTitle"] = "PLATE"
            
            # 3. Project Info
            proj_match = re.search(r'PROJECT\s+DESCRIPTION\s*[:.]*\s*(.*)', text, re.I)
            if proj_match:
                fields["projectName"] = proj_match.group(1).split("\n")[0].strip()
            
            client_match = re.search(r'PROJECT\s+OWNER\s*[:.]*\s*(.*)', text, re.I)
            if client_match:
                fields["clientName"] = client_match.group(1).split("\n")[0].strip()

            # 4. Revision Table
            rev_rows = re.findall(r'(\d+)\s+([A-Z]{2,3})\s+(.*?)\s+([A-Z]{3}\s+\d+\s+\d{4})', text, re.I)
            for r in rev_rows:
                fields["revisionHistory"].append({
                    "mark": r[0],
                    "date": r[3],
                    "remarks": r[2]
                })
            
            if fields["revisionHistory"]:
                latest = fields["revisionHistory"][-1]
                fields["revision"] = latest["mark"]
                fields["date"] = latest["date"]
                fields["remarks"] = latest["remarks"]

    except Exception as e:
        fields["description"] = f"Local error: {str(e)}"
        
    return fields

pdf_path = r'uploads\drawings\699d71b504865099b08be7a2\1771926590173_pl426_0.pdf'
data = extract_locally(pdf_path)
import json
print(json.dumps(data, indent=2))
