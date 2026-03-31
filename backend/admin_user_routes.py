"""
============================================================
Admin User Routes  (Python equivalent of routes/adminUserRoutes.js)
============================================================
Handles user management, bulk creation, and dashboard stats.
"""

from fastapi import APIRouter, Depends, UploadFile, File, Query
import pandas as pd
import bcrypt
import logging
from typing import Optional

from auth_middleware import require_admin
from database import get_db, db_instance
from stats_worker import attach_project_stats

logger = logging.getLogger("admin_user_routes")
router = APIRouter(prefix="/api/admin", tags=["Admin Users & Dashboard"])

# ── User Management ───────────────────────────────────────

@router.get("/users", summary="List Users")
async def list_users(principal: dict = Depends(require_admin)):
    db = get_db()
    cursor = db["users"].find({"adminId": principal["_id"]}).sort("createdAt", -1)
    users = await cursor.to_list(None)
    
    # Strip sensitive data
    safe_users = []
    for u in users:
        u["_id"] = str(u["_id"])
        u["id"] = u["_id"]
        u["adminId"] = str(u.get("adminId", ""))
        u.pop("password", None)
        u.pop("password_hash", None)
        safe_users.append(u)
        
    return {"users": safe_users}


@router.post("/users", summary="Create User", status_code=201)
async def create_user(body: dict, principal: dict = Depends(require_admin)):
    db = get_db()
    
    username = body.get("username", "").strip()
    email = body.get("email", "").strip()
    password = body.get("password", "")
    display_name = body.get("displayName", "")
    
    if not username or not email or not password:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Username, email, and password are required")
        
    # Check duplicate
    existing = await db["users"].find_one({"$or": [{"username": username}, {"email": email}]})
    if existing:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Username or email already exists")
        
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    from passlib.context import CryptContext
    # We replaced passlib in auth_handler.py, let's use bcrypt directly.
    import bcrypt
    
    salt = bcrypt.gensalt()
    # Handle the fact that we might only get strings
    pw_bytes = password.encode('utf-8')
    hashed_pw = bcrypt.hashpw(pw_bytes, salt).decode('utf-8')
    
    doc = {
        "username": username,
        "email": email,
        "password_hash": hashed_pw,
        "displayName": display_name,
        "role": "user",
        "status": "active",
        "adminId": principal["_id"],
        "createdAt": now,
        "updatedAt": now
    }
    
    res = await db["users"].insert_one(doc)
    doc["_id"] = str(res.inserted_id)
    doc["id"] = doc["_id"]
    doc["adminId"] = str(doc["adminId"])
    doc.pop("password", None)
    doc.pop("password_hash", None)
    
    return {"user": doc}


@router.patch("/users/{user_id}", summary="Update User")
async def update_user(user_id: str, body: dict, principal: dict = Depends(require_admin)):
    db = get_db()
    from bson import ObjectId
    from fastapi import HTTPException
    
    try:
        oid = ObjectId(user_id)
    except:
        raise HTTPException(status_code=400, detail="Invalid user ID format")
        
    user = await db["users"].find_one({"_id": oid, "adminId": principal["_id"]})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    updates = {}
    if "status" in body: updates["status"] = body["status"]
    if "displayName" in body: updates["displayName"] = body["displayName"]
    if "email" in body: updates["email"] = body["email"]
    if "role" in body: updates["role"] = body["role"]
    
    if "password" in body and body["password"]:
        import bcrypt
        salt = bcrypt.gensalt()
        pw_bytes = body["password"].encode('utf-8')
        hashed_pw = bcrypt.hashpw(pw_bytes, salt).decode('utf-8')
        updates["password_hash"] = hashed_pw
        
    if not updates:
        # Just return existing
        user["_id"] = str(user["_id"])
        user["id"] = user["_id"]
        user["adminId"] = str(user["adminId"])
        user.pop("password_hash", None)
        return {"user": user}
        
    from datetime import datetime, timezone
    updates["updatedAt"] = datetime.now(timezone.utc)
    
    await db["users"].update_one({"_id": oid}, {"$set": updates})
    updated_user = await db["users"].find_one({"_id": oid})
    
    updated_user["_id"] = str(updated_user["_id"])
    updated_user["id"] = updated_user["_id"]
    updated_user["adminId"] = str(updated_user["adminId"])
    updated_user.pop("password_hash", None)
    
    return {"user": updated_user}


@router.delete("/users/{user_id}", summary="Delete User")
async def delete_user(user_id: str, principal: dict = Depends(require_admin)):
    db = get_db()
    from bson import ObjectId
    from fastapi import HTTPException
    
    try:
        oid = ObjectId(user_id)
    except:
        raise HTTPException(status_code=400, detail="Invalid user ID format")
        
    user = await db["users"].find_one({"_id": oid, "adminId": principal["_id"]})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    # Remove from project assignments
    await db["projects"].update_many(
        {"assignments.userId": oid},
        {"$pull": {"assignments": {"userId": oid}}}
    )
        
    await db["users"].delete_one({"_id": oid})
    return {"success": True, "message": "User and assignments removed"}


@router.post("/users/bulk", summary="Bulk Create Users")
async def bulk_create_users(file: UploadFile = File(...), principal: dict = Depends(require_admin)):
    db = get_db()
    import pandas as pd
    import io
    from fastapi import HTTPException
    from datetime import datetime, timezone
    import bcrypt
    
    if not file.filename.endswith(('.xlsx', '.xls')):
        raise HTTPException(status_code=400, detail="Only Excel files (.xlsx) are supported")
        
    content = await file.read()
    try:
        df = pd.read_excel(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read Excel file: {e}")
        
    # Check headers
    required = ["username", "email", "password"]
    cols = [str(c).lower().strip() for c in df.columns]
    
    col_map = {}
    for i, c in enumerate(cols):
        if "username" in c: col_map["username"] = df.columns[i]
        elif "email" in c: col_map["email"] = df.columns[i]
        elif "password" in c: col_map["password"] = df.columns[i]
        elif "displayname" in c or "name" in c: col_map["displayName"] = df.columns[i]
        
    if not all(k in col_map for k in required):
        raise HTTPException(status_code=400, detail="Excel must contain 'username', 'email', and 'password' columns")
        
    created = 0
    failed_rows = []
    
    for idx, row in df.iterrows():
        try:
            username = str(row[col_map["username"]]).strip()
            email = str(row[col_map["email"]]).strip()
            password = str(row[col_map["password"]]).strip()
            display_name = str(row.get(col_map.get("displayName", ""), username)).strip()
            
            if not username or not email or not password or username == 'nan':
                continue
                
            # Check exist
            if await db["users"].find_one({"$or": [{"username": username}, {"email": email}]}):
                failed_rows.append(f"Row {idx+2}: username or email already exists")
                continue
                
            salt = bcrypt.gensalt()
            pw_bytes = password.encode('utf-8')
            hashed_pw = bcrypt.hashpw(pw_bytes, salt).decode('utf-8')
            
            now = datetime.now(timezone.utc)
            doc = {
                "username": username,
                "email": email,
                "password_hash": hashed_pw,
                "displayName": display_name,
                "role": "user",
                "status": "active",
                "adminId": principal["_id"],
                "createdAt": now,
                "updatedAt": now
            }
            await db["users"].insert_one(doc)
            created += 1
        except Exception as e:
            failed_rows.append(f"Row {idx+2}: {str(e)}")
            
    return {
        "message": f"Successfully created {created} users.",
        "results": {
            "created": created,
            "failedRows": failed_rows
        }
    }


# ── Dashboard & Reporting ─────────────────────────────────

@router.get("/dashboard/stats", summary="Get Dashboard Stats")
async def dashboard_stats(principal: dict = Depends(require_admin)):
    db = get_db()
    admin_id = principal["_id"]

    # Projects
    projects_cursor = await db["projects"].find({"adminId": admin_id}).to_list(None)
    total_projects = len(projects_cursor)
    active_projects = sum(1 for p in projects_cursor if p.get("status") == "active")
    completed_projects = sum(1 for p in projects_cursor if p.get("status") == "completed")
    on_hold_projects = sum(1 for p in projects_cursor if p.get("status") == "on_hold")

    # Users
    users_count = await db["users"].count_documents({"adminId": admin_id})

    # Extractions (Drawings/RFIs)
    total_drawings = await db["drawingextractions"].count_documents({"adminId": admin_id})
    completed_drawings = await db["drawingextractions"].count_documents({"adminId": admin_id, "status": "completed"})
    
    # Find all RFIs matching OPEN state across admin's projects
    # A simplified count just looking at all rfiextractions collections
    # Actual implementation might use aggregation if $unwind is needed
    pipeline = [
        {"$match": {"adminId": admin_id}},
        {"$unwind": "$rfis"},
        {"$match": {"rfis.status": "OPEN"}},
        {"$count": "openRfiCount"}
    ]
    rfi_result = await db["rfiextractions"].aggregate(pipeline).to_list(None)
    open_rfis = rfi_result[0]["openRfiCount"] if rfi_result else 0

    return {
        "stats": {
            "totalProjects": total_projects,
            "activeProjects": active_projects,
            "completedProjects": completed_projects,
            "onHoldProjects": on_hold_projects,
            "totalUsers": users_count,
            "totalUsersCount": users_count, # Support both key variations
            "totalDrawings": total_drawings,
            "completedDrawings": completed_drawings,
            "openRfis": open_rfis,
            "pendingTransmittals": 0, # Pending transmittals placeholder
        }
    }


@router.get("/reports", summary="Get Reports Data")
async def reports_data(days: int = Query(30), principal: dict = Depends(require_admin)):
    # Fallback endpoint that returns empty data structures if the UI expects it
    # Currently mostly placeholder because full reporting logic is complex
    return {
        "days": days,
        "drawingsProcessed": [],
        "rfisGenerated": [],
        "transmittalsSent": []
    }
