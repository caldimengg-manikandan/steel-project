import pdfplumber

def dump():
    with pdfplumber.open('backend/uploads/drawings/69b8dc665fbf98fa764aab2c/1773722791822_02B1001_0.pdf') as doc:
        tbl = doc.pages[0].extract_tables()[0]
        c_htypes = {i:"" for i in range(len(tbl[0]))}
        for row in tbl:
            for j in range(min(len(tbl[0]), len(row))):
                v = str(row[j] or '').strip().upper()
                if not v: continue
                if any(x == v for x in ["REV", "REV."]): c_htypes[j] = "mark"
                elif "DATE" in v and len(v)<15: c_htypes[j] = "date"
                elif "REMARKS" in v: c_htypes[j] = "rem"
                elif any(x in v for x in ["DESCRIPTION", "DESC", "REVISIONS"]): c_htypes[j] = "desc"
        print(c_htypes)

dump()
