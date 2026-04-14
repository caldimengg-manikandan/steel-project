import re

clean_text = """
Date Drawing Title:
01/ 20/ 2025 SOW #03 -SOUTH WEST FRAMING
SECTIONS
Scale
VARIES
"""

dt_match = re.search(r'Drawing\s*Title:\s*\n(.*?)(?=\nScale|\Z)', clean_text, re.I | re.S)
print("1 dt_match", dt_match.groups() if dt_match else None)

clean_text2 = """
Date
01/ 20/ 2025
Scale
VARIES
Drawing Title:
SOW #03 -SOUTH WEST FRAMING
SECTIONS
"""
dt_match2 = re.search(r'Drawing\s*Title:\s*\n(.*?)(?=\n(?:Scale|Date|Contract|\Z))', clean_text2, re.I | re.S)
print("2 dt_match", dt_match2.groups() if dt_match2 else None)

