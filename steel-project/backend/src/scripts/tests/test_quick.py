import os, json
pdf_dir = r"backend/uploads/drawings/69b8dc665fbf98fa764aab2c"
pdfs = [f for f in os.listdir(pdf_dir) if f.endswith(".pdf")][:5]
for f in pdfs:
    path = os.path.join(pdf_dir, f)
    print(f"=== {f} ===")
    out = os.popen(f"python backend/src/scripts/extract_drawing.py {path}").read()
    try:
        line = out.strip().splitlines()[-1]
        data = json.loads(line)
        fields = data.get("fields", {})
        revs = fields.get("revisionHistory", [])
        rem_tb = fields.get("remarks", "")
        print(f"  TB Remarks: {rem_tb}")
        for r in revs:
            mark = r.get("mark")
            date = r.get("date")
            remarks = r.get("remarks")
            print(f"  Mark: {mark}, Date: {date}, Remarks: {remarks}")
    except Exception as e:
        print(f"Error: {e}")
