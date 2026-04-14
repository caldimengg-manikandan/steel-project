import os, json
from concurrent.futures import ThreadPoolExecutor

pdf_dir = r"backend/uploads/drawings/69b8dc665fbf98fa764aab2c"
pdfs = [os.path.join(pdf_dir, f) for f in os.listdir(pdf_dir) if f.endswith(".pdf")]

def process(path):
    f = os.path.basename(path)
    out = os.popen(f"python backend/src/scripts/extract_drawing.py {path}").read()
    try:
        line = out.strip().splitlines()[-1]
        data = json.loads(line)
        revs = data.get("fields", {}).get("revisionHistory", [])
        res = f"=== {f} ===\n"
        if not revs:
            res += "NO REVISIONS FOUND!\n"
        for r in revs:
            mark = r.get("mark")
            date = r.get("date")
            remarks = r.get("remarks")
            res += f"  Mark: {mark}, Date: {date}, Remarks: {remarks}\n"
        return res
    except Exception as e:
        return f"=== {f} ===\nError: {e}\n"

with ThreadPoolExecutor(max_workers=10) as executor:
    results = list(executor.map(process, pdfs))

with open("all_revs.txt", "w", encoding="utf-8") as out_f:
    for res in results:
        out_f.write(res)
