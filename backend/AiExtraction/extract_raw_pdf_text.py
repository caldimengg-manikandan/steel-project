import fitz
import os
import glob

temp_dir = os.path.join(os.environ.get("TEMP", ""), "steel-dms-uploads")
print(f"Searching in temp directory: {temp_dir}")

if os.path.exists(temp_dir):
    files = glob.glob(os.path.join(temp_dir, "*.pdf"))
    print(f"Found {len(files)} PDFs in temp directory.")
    # Find files that contain the text 'F-14' inside them or check all files
    for pdf_path in files:
        try:
            doc = fitz.open(pdf_path)
            # Search first page text for 'F-14.00' or 'F-14'
            page = doc[0]
            text = page.get_text()
            if "F-14" in text or "F-14.00" in text or "F-14.01" in text:
                print(f"\n======================================")
                print(f"MATCHED PDF: {pdf_path}")
                print(f"======================================")
                blocks = page.get_text("blocks")
                for b in sorted(blocks, key=lambda x: (x[1], x[0])):
                    print(f"BBox: ({b[0]:.1f}, {b[1]:.1f}, {b[2]:.1f}, {b[3]:.1f}) | Text: {repr(b[4].strip())}")
                doc.close()
                break
            doc.close()
        except Exception as e:
            print(f"Error reading {pdf_path}: {e}")
else:
    print("Temp directory does not exist.")
