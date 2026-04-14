import os, sys, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pdfplumber  # type: ignore

# Use the most recent 06B1014 upload
pdf_path = r'uploads\drawings\69c21352496ec2eb76f48635\1774328137289_06B1014_0.pdf'

with pdfplumber.open(pdf_path) as pdf:
    page = pdf.pages[0]
    text = page.extract_text(layout=True, x_tolerance=2.0) or ""

print("=== RAW TEXT ===")
for i, line in enumerate(text.splitlines()):
    print(f"{i+1:3}: {repr(line)}")

# Check what the revision table extraction finds
print("\n=== REVISION TABLE (pdfplumber) ===")
with pdfplumber.open(pdf_path) as pdf:
    page = pdf.pages[0]
    tables = page.extract_tables()
    for ti, table in enumerate(tables):
        print(f"\n  Table {ti}: {len(table)} rows")
        for row in table:
            print(f"    {row}")

# Check regex patterns for remarks
print("\n=== REGEX REVISION PATTERNS ===")
# Pattern 1
p1 = re.findall(r'^[ \t]*(\d+)[ \t]+([A-Z0-9]{1,2})[ \t]+(.*?)[ \t]+(\d{1,2}\s*[-/]\s*\d{1,2}\s*[-/]\s*(?:20\d{2}|19\d{2}|\d{2}))[ \t]*$', text, re.I | re.M)
print(f"  Pattern1 (row# mark desc date): {p1}")

# Pattern 2
p2 = re.findall(r'\b([A-Z0-9]{1,2}|REV[ \t][A-Z0-9]{1,2})\b[ \t]+(?:[A-Z]{2,4}[ \t]+)?\b([A-Z]{3,}[ \t]+\d{1,2}[ \t]*,?[ \t]*\d{4})\b[ \t]+(.*)', text, re.I)
print(f"  Pattern2 (mark date desc): {p2}")

# Pattern for 'BE' mark
print("\n=== LINES AROUND 'BE' MARK ===")
for i, line in enumerate(text.splitlines()):
    if re.search(r'\bBE\b', line, re.I):
        print(f"  L{i+1}: {repr(line)}")
