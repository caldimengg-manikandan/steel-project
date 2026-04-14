import os
import glob
from backend.src.scripts.extract_drawing import extract_locally
from pprint import pprint

out = []
for p in glob.glob('backend/uploads/drawings/69b8dc665fbf98fa764aab2c/*.pdf')[:15]:
    res = extract_locally(p)
    out.append(f"FILE: {os.path.basename(p)}")
    out.append(f"  Remarks: {res.get('remarks')}")
    out.append(f"  Revision: {res.get('revision')} Date: {res.get('date')}")
    for r in res.get('revisionHistory', []):
        out.append(f"  {r}")
    
open('extraction_test.txt', 'w', encoding='utf-8').write('\n'.join(out))
