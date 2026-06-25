import os

search_paths = [
    r"e:\extraction",
    r"e:\steel\steel-detailing\steel-project\backend\uploads",
    r"e:\steel\steel-detailing\steel-project\backend\AiExtraction"
]

for base in search_paths:
    if os.path.exists(base):
        print(f"\nScanning: {base}")
        for root, dirs, files in os.walk(base):
            pdf_files = [f for f in files if f.endswith(".pdf")]
            if pdf_files:
                print(f"  - Folder: {root} contains {len(pdf_files)} PDFs:")
                for f in pdf_files[:5]:
                    print(f"    * {f}")
    else:
        print(f"\nPath does not exist: {base}")
