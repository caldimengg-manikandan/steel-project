import pdfplumber

pdf_path = r'uploads\drawings\699d886eca8ff2029140a2b6\1771931846412_05C1001_0.pdf'
with pdfplumber.open(pdf_path) as pdf:
    page = pdf.pages[0]
    chars = page.chars
    # Look for characters in "PRIMERSSUED"
    words = page.extract_words(x_tolerance=3, keep_blank_chars=False)
    for w in words:
        if "PRIMER" in w['text'] or "ISSUED" in w['text']:
            print(f"Word: {w['text']}, x0: {w['x0']}, x1: {w['x1']}")

    print("\n--- Testing x_tolerance 1 ---")
    words = page.extract_words(x_tolerance=1)
    for w in words:
        if "PRIMER" in w['text'] or "SSUED" in w['text']:
             print(f"Word: {w['text']}, x0: {w['x0']}, x1: {w['x1']}")
