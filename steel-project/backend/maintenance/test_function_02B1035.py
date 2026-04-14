import sys
import os
import json
# Add src to path
sys.path.append(os.path.join(os.getcwd(), 'src'))
from scripts.extract_drawing import extract_locally

pdf_path = r'uploads\drawings\699d886eca8ff2029140a2b6\1771931844543_02B1035_0.pdf'
if os.path.exists(pdf_path):
    res = extract_locally(pdf_path)
    print(json.dumps(res, indent=2))
else:
    print("File not found")
