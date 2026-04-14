import pdfplumber
import os

pdf_path = r'uploads\drawings\699d886eca8ff2029140a2b6\1771931844543_02B1035_0.pdf'
with pdfplumber.open(pdf_path) as pdf:
    page = pdf.pages[0]
    text = page.extract_text()
    print("--- RAW TEXT ---")
    print(text)
    print("--- END RAW TEXT ---")
