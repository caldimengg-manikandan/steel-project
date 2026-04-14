import fitz
import glob
import os

pdf_path = max(glob.glob("uploads/rfis/**/*.pdf", recursive=True), key=os.path.getmtime)
doc = fitz.open(pdf_path)

out_text = ""
for page_idx, page in enumerate(doc):
    all_text_elements = []
    
    for annot in page.annots():
        info = annot.info
        content = info.get('content', '')
        if content:
            all_text_elements.append({
                'text': content.strip(),
                'y0': annot.rect.y0,
                'x0': annot.rect.x0
            })
            
    all_text_elements.sort(key=lambda item: (round(item['y0'] / 10), item['x0']))
    page_text = "\n".join(item['text'] for item in all_text_elements)
    if page_text:
        out_text += page_text + "\n\n"

with open("test_annot.txt", "w", encoding="utf-8") as f:
    f.write(out_text)
