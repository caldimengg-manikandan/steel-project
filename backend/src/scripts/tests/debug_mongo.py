import os
import pymongo
from bson import ObjectId
from dotenv import load_dotenv

load_dotenv()
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/steel_dms")

def debug_counts():
    client = pymongo.MongoClient(MONGO_URI)
    db = client.get_database()
    
    print(f"Connected to DB: {db.name}")
    print(f"Collections: {db.list_collection_names()}")
    
    projects = list(db.projects.find())
    print(f"\nFound {len(projects)} projects.")
    
    for p in projects:
        p_id = p['_id']
        name = p.get('name')
        
        ext_count = db.drawing_extractions.count_documents({"projectId": p_id})
        rfi_count = db.rfiextractions.count_documents({"projectId": p_id})
        
        print(f"Project: {name} (ID: {p_id})")
        print(f"  - Extractions Count: {ext_count}")
        print(f"  - RFIs Count: {rfi_count}")
        
    client.close()

if __name__ == "__main__":
    debug_counts()
