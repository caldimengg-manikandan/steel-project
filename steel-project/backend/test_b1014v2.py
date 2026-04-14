import sys, json
sys.path.insert(0, '.')
from src.scripts.extract_drawing import extract_locally  # type: ignore

r = extract_locally(r'uploads\drawings\69c21352496ec2eb76f48635\1774328137289_06B1014_0.pdf')
print('revision (latest):', r.get('revision'))
print('date:', r.get('date'))
print('remarks:', r.get('remarks'))
print()
print('revision history:')
for rev in r.get('revisionHistory', []):
    print(f"  mark={rev.get('mark')!r}  date={rev.get('date')!r}  remarks={rev.get('remarks')!r}")
