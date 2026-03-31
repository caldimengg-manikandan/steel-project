import asyncio, traceback
from database import connect_to_mongo, close_mongo_connection, db_instance
from passlib.context import CryptContext

async def check():
    await connect_to_mongo()
    db = db_instance.db
    ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
    a = await db["admins"].find_one({"username": "admin1"})
    print("Found admin1:", bool(a))
    if a:
        pw = "Admin1@2026"
        hashed = a.get("password_hash", "")
        print("Hash in DB:", type(hashed), len(hashed))
        print("Hash repr:", repr(hashed))
        try:
            res = ctx.verify(pw, hashed)
            print("Verify Result:", res)
        except Exception as e:
            traceback.print_exc()
    await close_mongo_connection()

if __name__ == "__main__":
    asyncio.run(check())
