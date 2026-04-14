import pdfplumber
import sys
import json

pdf_path = r"c:\Users\vibhu\steel-project\backend\uploads\drawings\69b38fccf0b20463d0ce86f0\1773375452412_06C1012_0.pdf"
with pdfplumber.open(pdf_path) as pdf:
    p0 = pdf.pages[0]
    tables = p0.extract_tables()
    print(json.dumps(tables, indent=2))
