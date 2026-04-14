import sys, re
sys.path.insert(0, '.')
from src.scripts.extract_drawing import clean_rem  # type: ignore

tests = [
    # (input, expected_output)
    ("1. ALL PLATES AND ANGLES ATTACHED SHALL BE CENTERED TO MAIN MEMBER U.N.O. A GSV ISSUED FOR APPROVAL",
     "ISSUED FOR APPROVAL"),
    ("ISSUED FOR APPROVAL",
     "ISSUED FOR APPROVAL"),
    ("ISSUED FOR FABRICATION",
     "ISSUED FOR FABRICATION"),
    ("2. ALL RUNNING DIMENSIONS ARE MEASURED FROM LEFT END OF BEAM INDICATED THUS 0 GSV ISSUED FOR FABRICATION",
     "ISSUED FOR FABRICATION"),
    ("FOR APPROVAL",
     "FOR APPROVAL"),
    ("x ISSUED FOR APPROVAL",  # leading noise
     "ISSUED FOR APPROVAL"),
]

print("Testing clean_rem:")
all_ok = True
for inp, expected in tests:
    result = clean_rem(inp)
    status = "OK" if result == expected else "FAIL"
    if status == "FAIL":
        all_ok = False
    print(f"  [{status}] {inp[:60]!r} -> {result!r}  (expected: {expected!r})")

print()
print("All tests passed!" if all_ok else "SOME TESTS FAILED!")
