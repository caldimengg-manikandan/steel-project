import fitz
import sys
import json

def test(pdf_path):
    doc = fitz.open(pdf_path)
    page = doc[0]
    drawings = page.get_drawings()
    print("Found", len(drawings), "drawings")
    for d in drawings:
        if d.get('fill') or d.get('color'):
            print(f"Rect: {d['rect']}, Fill: {d.get('fill')}, Color: {d.get('color')}")
    doc.close()

if __name__ == '__main__':
    test(sys.argv[1])
