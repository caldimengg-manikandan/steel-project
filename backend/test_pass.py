import traceback
from passlib.context import CryptContext

ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
secret = "Admin1@2026"
hash_val = "$2a$12$gzazMMSQWQ/Oy1yS5x.7N...etc"

with open("test_out.txt", "w", encoding="utf-8") as f:
    try:
        # Just hashing and verifying locally to see if passlib itself is working
        h = ctx.hash(secret)
        res = ctx.verify(secret, h)
        f.write(f"Hash: {h}\nVerify: {res}\n")
    except Exception as e:
        f.write("ERROR!\n")
        traceback.print_exc(file=f)
