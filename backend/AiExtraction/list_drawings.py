import os
folder = r"e:\steel\steel-detailing\steel-project\backend\AiExtraction\drawings"
if os.path.exists(folder):
    files = [f for f in os.listdir(folder) if f.endswith(".pdf")]
    print(f"Total PDFs in drawings: {len(files)}")
    print("Files:")
    for f in sorted(files):
        if "14" in f or "F-" in f or "f-" in f or "F_" in f:
            print(f"  * {f}")
else:
    print("Directory does not exist")
