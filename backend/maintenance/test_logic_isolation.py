import re
import os

pdf_path = "1771931804439_pl426_0.pdf"
clean_text = "DWG STEEL FAB ENTERPRISES, INC. DESCRIPTION : PLATE DWG pl426 0" # Simulation

fields = {"drawingNumber": ""}
fn_base = os.path.basename(pdf_path).split('_')
fn_hint = next((p for p in fn_base if re.search(r'\d+[A-Z]\d+|S-\d+|[A-Z]{2,}\d+', p)), "")

dn_match = re.search(r'DWG\s*(?:NO)?\s*[:.\s]+(\S+)', clean_text, re.I)
if dn_match:
    dn_val = dn_match.group(1).strip()
    print(f"DEBUG: Found dn_val='{dn_val}', isdigit={any(c.isdigit() for c in dn_val)}")
    if dn_val.upper() not in ["DESCRIPTION", "TITLE", "PROJECT", "DWG", "STEEL", "FAB"] and \
       len(dn_val) > 2 and any(c.isdigit() for c in dn_val):
        fields["drawingNumber"] = dn_val

if not fields["drawingNumber"] and fn_hint:
    print(f"DEBUG: Using fn_hint='{fn_hint}'")
    fields["drawingNumber"] = fn_hint.replace(".pdf", "")

print(f"RESULT: {fields['drawingNumber']}")
