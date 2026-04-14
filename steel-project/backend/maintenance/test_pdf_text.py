import pdfplumber
import os
import re

pdf_path = r'uploads\drawings\699d71b504865099b08be7a2\1771926590173_pl426_0.pdf'

def find_value_after_label(text, label):
    # Try to find the label and then the next line or next word
    match = re.search(f"{label}[:\s]+(.*)", text, re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return None

with pdfplumber.open(pdf_path) as pdf:
    page = pdf.pages[0]
    text = page.extract_text()
    print("Full Text Extracted:")
    print(text)
    print("\n" + "="*50 + "\n")

    # Labels to look for
    labels = ["DWG NO", "DWG DESCRIPTION", "REV #", "DATE", "DESCRIPTION", "PROJECT NO", "PROJECT DESCRIPTION"]
    
    for label in labels:
        val = find_value_after_label(text, label)
        print(f"{label}: {val}")

    # Check for "PLATE" specifically
    if "PLATE" in text:
        print("\nFound 'PLATE' in text.")
    
    # Check for "pl426" specifically
    if "pl426" in text:
        print("Found 'pl426' in text.")
