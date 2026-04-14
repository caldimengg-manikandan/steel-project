import pdfplumber
import re

pdf_path = r'uploads\drawings\699d886eca8ff2029140a2b6\1771931846412_05C1001_0.pdf'
with pdfplumber.open(pdf_path) as pdf:
    text = pdf.pages[0].extract_text(layout=True, x_tolerance=2)
    print("--- RAW LAYOUT TEXT ---")
    # print first 2000 chars
    print(text[:2000])
    
    # Test regex
    title_match = re.search(r'DWG\s+DESCRIPTION\s*[:.\s]+(.*?)(?=\n|[A-Z]{3,}:|MARK|QTY|FT|IN|WEIGHT|$)', text, re.I)
    if title_match:
        print(f"\nFOUND DWG DESC: '{title_match.group(1).strip()}'")
    else:
        print("\nNOT FOUND DWG DESC")
        # Try generic
        title_match = re.search(r'(?<!PROJECT\s)DESCRIPTION\s*[:.\s]+(.*?)(?=\n|[A-Z]{3,}:|MARK|QTY|FT|IN|WEIGHT|$)', text, re.I)
        if title_match:
            print(f"FOUND GENERIC DESC: '{title_match.group(1).strip()}'")
