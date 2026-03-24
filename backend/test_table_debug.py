import sys, json, re
sys.path.insert(0, '.')
import pdfplumber  # type: ignore

pdf_path = r'uploads/drawings/69c21352496ec2eb76f48635/1774328137289_06B1014_0.pdf'

DATE_HDR   = re.compile(r'\b(?:date|dt|issued?)\b', re.I)
REV_HDR    = re.compile(r'\b(?:rev(?:ision)?|issue|mark|no\.?)\b', re.I)
DESC_HDR   = re.compile(r'\b(?:desc(?:ription)?|remark|destination|purpose|notes?|status|action)\b', re.I)
DATE_CELL  = re.compile(
    r'\b(\d{1,2}\s*[-/\.]\s*\d{1,2}\s*[-/\.]\s*(?:20\d{2}|19\d{2}|\d{2})|'
    r'(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s,]+\d{1,2}[\s,]+\d{4})\b',
    re.I
)
MARK_CELL  = re.compile(r'^[A-Z0-9]{1,2}$', re.I)

with pdfplumber.open(pdf_path) as pdf:
    page = pdf.pages[0]
    tables = page.extract_tables()

print(f"Total tables: {len(tables)}")
for ti, table in enumerate(tables):
    print(f"\nTable {ti}: {len(table)} rows")
    
    header_idx = None
    col_rev = col_date = col_desc = None
    
    for row_i, row in enumerate(table):
        row_text = [str(c or '').strip() for c in (row or [])]
        row_joined = [c.replace('\n', ' ').replace('/', ' ') for c in row_text]
        short_cells = [c for c in row_joined if len(c) <= 60]
        has_rev  = any(REV_HDR.search(c) for c in short_cells)
        has_date = any(DATE_HDR.search(c) for c in short_cells)
        
        if has_rev and has_date:
            header_idx = row_i
            for ci, cell in enumerate(row_joined):
                if len(cell) > 40: continue
                if DATE_HDR.search(cell): col_date = ci
                if REV_HDR.search(cell):  col_rev  = ci
                if DESC_HDR.search(cell): col_desc = ci
            print(f"  Header found at row {row_i}: col_rev={col_rev}, col_date={col_date}, col_desc={col_desc}")
            print(f"  Header row: {[c[:30] for c in row_text]}")
            break
    
    if header_idx is None:
        print("  No header found in this table!")
        continue
    
    # Show data rows
    print(f"  Data rows after header:")
    for row_i in range(header_idx + 1, min(len(table), header_idx + 10)):
        row = table[row_i]
        row_text = [str(c or '').strip() for c in (row or [])]
        
        mark  = row_text[col_rev]  if col_rev  is not None and col_rev  < len(row_text) else '?'
        date  = row_text[col_date] if col_date is not None and col_date < len(row_text) else '?'
        desc  = row_text[col_desc] if col_desc is not None and col_desc < len(row_text) else '?'
        mark_valid = bool(mark and MARK_CELL.match(mark))
        date_valid = bool(date and DATE_CELL.search(date))
        print(f"    row {row_i}: mark={mark!r}({mark_valid}) date={date!r}({date_valid}) desc={desc[:50]!r}")
