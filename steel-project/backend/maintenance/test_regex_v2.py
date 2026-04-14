import re
import os

text = """
90:33:30                                                                   DESCRIPTION : BEAM DETAIL
PAINT : SHOP PRIMER
2/12 :OTES: HOLES : 13/16 " DIA (U.N.O)
3LEAN : SSPC-SP35 ISSUED FOR FABRICATION N O. :
4/16-9ICATES FRAMING SIDE OF BEAM. PAINT STRIPE SHEAR TAB AS REQUIRED. DWG D
LE ALL PLATES AND ANGLES ATTACHED SHALL BE CENTERED to MAIN MEMBER U.N.O.   
pWT'L : A36 (U.N.O) CHECKED BY : GSV DATE : 06-09-2025 DWG 02B1035 0        
1-pl315RUNNING DIMENSIONS ARE MEASURED FROM LEFT END OF BEAM INDICATED THUS 
1-pl316Y MARK QTY DESCRIPTION FT IN WEIGHT WEIGHT
Section B-B BEAM PNT 1324 1324
02B103535 1 HSS8x8x3/8 26 15/8 A500C 985 985
A B276 3 L4x3x5/16 0 51/2 A36 3 10
1-a2766 1 PL3/8x14 10 0 A36 179 179
1-a276 B 1-a276x14 7 11 A36 141 141
A pl976 2 PL1/4x8 0 8 A36 5 9
Section A-At :
02B1035ORMATION NOTED HEREON THIS DRAWING IS THE
ONE BEAM 02B1035L FAB ENTERPRISES, INC. AND SHALL
1xTED BE USED WITHOUT WRITTEN CONSENT.
61/31 FAB
10-0 7-11ES, LLC
2-1CELLANEOUS METALS FABRICATOR AND ERECTORS
423 BAUMGARDNER ROAD, LANCASTER, PA 17603
01L. (717)464-0330 FAX (717)464-9464
1/4.STEELFABENTERPRISES.COM
1/4JECT OWNER : CK CAPITAL, LLC
8ROJECT DESCRIPTION : CLEVELAND BROTHERS-MILESBURG
61/310-1NTRANT CUT REVISIONS
8/51-62 ADDRESS : 1025N. EAGLE VALLY ROAD, HOWARD, PA 16841
8O BE 1/2 " RADIUSED (U.N.O)
3EV DWN BY DATE DESCRIPTION CONTRACTOR : KINSLEY CONSTRUCTION, INC.
61/310-5270XX
3 GSV Jun 11 2025 ISSUED FOR APPROVAL DRAWN BY : BAS DATE : 06-07-2025 PROJ.
"""

clean_text = re.sub(r' +', ' ', text)
pdf_path = "1771931844543_02B1035_0.pdf"

print("--- 1. Drawing Number ---")
fn_base = os.path.basename(pdf_path).split('_')
fn_hint = next((p for p in fn_base if re.search(r'\d+[A-Z]\d+|S-\d+|[A-Z]{2,}\d+', p)), "")
print(f"FN Hint: {fn_hint}")

dn_match = re.search(r'DWG\s*(?:NO)?\s*[:.\s]+(\S+)', clean_text, re.I)
if dn_match and len(dn_match.group(1)) > 3:
    print(f"Match: {dn_match.group(1)}")
elif fn_hint:
    print(f"Use Hint: {fn_hint.replace('.pdf', '')}")
else:
    print("Fallback...")

print("\n--- 2. Title ---")
title_match = re.search(r'(?<!PROJECT\s)DESCRIPTION\s*[:.\s]+(.*?)(?=\n|[A-Z]{3,}:|$)', clean_text, re.I)
if title_match:
    print(f"Title: {title_match.group(1).strip()}")

print("\n--- 4. Revisions ---")
rev_hist = []
# Order 1: Mark By Description Date
rev_rows = re.findall(r'^(\d|REV\s\d)\s+([A-Z]{2,3})\s+(.*?)\s+([A-Z]{3}\s+\d{1,2}\s+\d{4})', clean_text, re.I | re.M)
if not rev_rows:
    # Order 2: Mark By Date Description
    rev_rows = re.findall(r'^(\d|REV\s\d)\s+([A-Z]{2,3})\s+([A-Z]{3}\s+\d{1,2}\s+\d{4})\s+(.*)', clean_text, re.I | re.M)
    for r in rev_rows:
        rev_hist.append({"mark": r[0], "date": r[2], "remarks": r[3]})
else:
    for r in rev_rows:
        rev_hist.append({"mark": r[0], "date": r[3], "remarks": r[2]})

print(f"Rev History: {rev_hist}")
