import pdfplumber
import sys

pdf_path = sys.argv[1]
with pdfplumber.open(pdf_path) as pdf:
    for page in pdf.pages:
        tbls = page.extract_tables()
        for i, tbl in enumerate(tbls):
            print(f"Table {i+1}:")
            for row in tbl:
                print([str(c).replace('\n', ' ') if c else '' for c in row])
