import pdfplumber
import re

pdf_path = r'uploads\drawings\699d886eca8ff2029140a2b6\1771931846412_05C1001_0.pdf'
with pdfplumber.open(pdf_path) as pdf:
    text = pdf.pages[0].extract_text(layout=True, x_tolerance=1.5)
    print("--- RAW TEXT ---")
    print(text)
