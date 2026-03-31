import os
import logging
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

# Logger setup
logger = logging.getLogger("database")

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/steel_dms")
DATABASE_NAME = "steel_dms" # You can also extract this from MONGO_URI if needed

class Database:
    client: AsyncIOMotorClient = None
    db = None

db_instance = Database()

async def connect_to_mongo():
    """Connect to MongoDB using Motor."""
    logger.info("Connecting to MongoDB...")
    db_instance.client = AsyncIOMotorClient(MONGO_URI)
    db_instance.db = db_instance.client.get_default_database()
    # Check if connected
    try:
        await db_instance.client.admin.command('ping')
        logger.info(f"[DB] MongoDB connected successfully to {MONGO_URI.split('@')[-1] if '@' in MONGO_URI else 'localhost'}")
    except Exception as e:
        logger.error(f"[DB] Connection failed: {e}")
        raise e

async def close_mongo_connection():
    """Close MongoDB connection."""
    logger.info("Closing MongoDB connection...")
    if db_instance.client:
        db_instance.client.close()
    logger.info("MongoDB connection closed.")

def get_db():
    """Helper to get the database instance."""
    return db_instance.db
