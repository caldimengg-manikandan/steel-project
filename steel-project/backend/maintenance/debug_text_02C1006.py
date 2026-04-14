import pdfplumber
pdf_path = r'uploads\drawings\699d886eca8ff2029140a2b6\1771931844591_02C1006_0.pdf'
with pdfplumber.open(pdf_path) as pdf:
    print(pdf.pages[0].extract_text())
