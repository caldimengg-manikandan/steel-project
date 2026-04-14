import pdfplumber
import sys

if len(sys.argv) < 2:
    print("Usage: python debug_dump.py <pdf_path>")
    sys.exit(1)

pdf_path = sys.argv[1]
try:
    with pdfplumber.open(pdf_path) as pdf:
        text = pdf.pages[0].extract_text(layout=True, x_tolerance=2)
        print(text)
except Exception as e:
    print(f"Error: {e}")
