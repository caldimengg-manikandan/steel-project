import os, json
pdf_dir = r"backend/uploads/drawings/69b8dc665fbf98fa764aab2c"
with open("all_revs.txt", "w") as out_f:
    for f in os.listdir(pdf_dir):
        if f.endswith(".pdf"):
            path = os.path.join(pdf_dir, f)
            out_f.write(f"=== {f} ===\n")
            out = os.popen(f"python backend/src/scripts/extract_drawing.py {path}").read()
            try:
                line = out.strip().splitlines()[-1]
                data = json.loads(line)
                revs = data.get("fields", {}).get("revisionHistory", [])
                if not revs:
                    out_f.write("NO REVISIONS FOUND!\n")
                for r in revs:
                    mark = r.get("mark")
                    date = r.get("date")
                    remarks = r.get("remarks")
                    out_f.write(f"  Mark: {mark}, Date: {date}, Remarks: {remarks}\n")
            except Exception as e:
                out_f.write("Error: " + str(e) + "\n")
