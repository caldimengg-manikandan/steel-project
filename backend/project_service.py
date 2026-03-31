"""
============================================================
Project Service  (Python equivalent of controllers/adminProjectsController.js)
============================================================
All project CRUD operations. Each function receives the
`principal` dict injected by the auth dependency.

Routes handled:
  GET    /api/admin/projects
  POST   /api/admin/projects
  GET    /api/admin/projects/{project_id}
  PATCH  /api/admin/projects/{project_id}
  DELETE /api/admin/projects/{project_id}
  POST   /api/admin/projects/{project_id}/assignments
  DELETE /api/admin/projects/{project_id}/assignments/{user_id}
============================================================
"""

import logging
from datetime import datetime, timezone
from typing import Optional
from bson import ObjectId
from fastapi import HTTPException, status, UploadFile
from pydantic import BaseModel

from database import get_db
from stats_worker import attach_project_stats

logger = logging.getLogger("project_service")

VALID_STATUSES = {"active", "on_hold", "completed", "archived"}
VALID_PERMISSIONS = {"viewer", "editor", "admin"}
VALID_LOCATIONS = {"Chennai", "Hosur", ""}


# ── Pydantic Schemas ─────────────────────────────────────

class ContactPerson(BaseModel):
    name: Optional[str] = ""
    email: Optional[str] = ""
    phone: Optional[str] = ""
    designation: Optional[str] = ""


class SequenceItem(BaseModel):
    name: str
    status: Optional[str] = "Not Completed"
    deadline: Optional[str] = None
    approvalDate: Optional[str] = None
    fabricationDate: Optional[str] = None


class CreateProjectBody(BaseModel):
    name: str
    clientName: Optional[str] = ""
    clientId: Optional[str] = None
    contactPerson: Optional[ContactPerson] = None
    description: Optional[str] = ""
    status: Optional[str] = "active"
    location: Optional[str] = ""
    approximateDrawingsCount: Optional[int] = 0
    sequences: Optional[list[SequenceItem]] = []
    connectionDesignVendor: Optional[str] = ""
    connectionDesignContact: Optional[str] = ""
    connectionDesignEmail: Optional[str] = ""


class UpdateProjectBody(BaseModel):
    name: Optional[str] = None
    clientName: Optional[str] = None
    clientId: Optional[str] = None
    contactPerson: Optional[ContactPerson] = None
    description: Optional[str] = None
    status: Optional[str] = None
    location: Optional[str] = None
    approximateDrawingsCount: Optional[int] = None
    sequences: Optional[list] = None
    connectionDesignVendor: Optional[str] = None
    connectionDesignContact: Optional[str] = None
    connectionDesignEmail: Optional[str] = None


class AssignUserBody(BaseModel):
    userId: str
    permission: Optional[str] = "viewer"


# ── Helpers ──────────────────────────────────────────────

def _safe_oid(val: str) -> ObjectId:
    """Convert a string to ObjectId, raising 400 if invalid."""
    try:
        return ObjectId(val)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid ID format: {val}")


def _serialize(obj):
    """Recursively convert ObjectIds and nested structures to ensure JSON serialization."""
    if isinstance(obj, list):
        return [_serialize(i) for i in obj]
    elif isinstance(obj, dict):
        res = {}
        for k, v in obj.items():
            if k == '_id':
                res['id'] = str(v)
                res['_id'] = str(v)
            else:
                res[k] = _serialize(v)
        return res
    if isinstance(obj, ObjectId):
        return str(obj)
    return obj


async def _get_scoped_project(project_id: str, admin_id: str) -> dict:
    """
    Load a project and confirm it belongs to this admin.
    Mirrors scopeProjectToAdmin middleware.
    """
    db = get_db()
    try:
        oid = ObjectId(project_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid projectId format.")

    project = await db["projects"].find_one({"_id": oid})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")

    # Scope check — project must belong to this admin
    proj_admin = str(project.get("createdByAdminId", ""))
    if proj_admin != admin_id:
        raise HTTPException(status_code=403, detail="Access denied: project belongs to another admin.")

    return project


# ── CRUD Operations ──────────────────────────────────────

async def list_projects(principal: dict, status_filter: str = None, search: str = None) -> dict:
    """
    GET /api/admin/projects
    List all projects. Supports ?status= and ?search= filters.
    Mirrors listProjects() from adminProjectsController.js.
    """
    db = get_db()
    query: dict = {"createdByAdminId": ObjectId(principal["adminId"])}

    if status_filter:
        query["status"] = status_filter
    if search:
        query["$or"] = [
            {"name": {"$regex": search, "$options": "i"}},
            {"clientName": {"$regex": search, "$options": "i"}},
        ]

    cursor = db["projects"].find(query).sort("createdAt", -1)
    raw_projects = await cursor.to_list(None)

    projects_with_stats = await attach_project_stats(raw_projects)
    serialized = [_serialize(p) for p in projects_with_stats]

    return {"count": len(serialized), "projects": serialized}


async def create_project(principal: dict, body: CreateProjectBody) -> dict:
    """
    POST /api/admin/projects
    Mirrors createProject() in adminProjectsController.js.
    """
    db = get_db()
    admin_id = principal["adminId"]

    if not body.name or (not body.clientName and not body.clientId):
        raise HTTPException(
            status_code=400,
            detail="name and either clientName or clientId are required."
        )

    if body.status and body.status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status: {body.status}")

    now = datetime.now(timezone.utc)
    doc = {
        "name": body.name.strip(),
        "clientName": body.clientName or "",
        "clientId": _safe_oid(body.clientId) if body.clientId else None,
        "contactPerson": body.contactPerson.model_dump() if body.contactPerson else None,
        "description": body.description or "",
        "status": body.status or "active",
        "location": body.location or "",
        "approximateDrawingsCount": body.approximateDrawingsCount or 0,
        "sequences": [s.model_dump() for s in (body.sequences or [])],
        "connectionDesignVendor": body.connectionDesignVendor or "",
        "connectionDesignContact": body.connectionDesignContact or "",
        "connectionDesignEmail": body.connectionDesignEmail or "",
        "createdByAdminId": ObjectId(admin_id),
        "drawingCount": 0,
        "transmittalCount": 0,
        "assignments": [
            {
                "userId": ObjectId(principal["id"]),
                "username": principal["username"],
                "permission": "admin",
                "assignedAt": now,
            }
        ],
        "createdAt": now,
        "updatedAt": now,
    }

    result = await db["projects"].insert_one(doc)
    project = await db["projects"].find_one({"_id": result.inserted_id})
    return {"project": _serialize(project)}


async def get_project(principal: dict, project_id: str) -> dict:
    """
    GET /api/admin/projects/{project_id}
    Mirrors getProject() in adminProjectsController.js.
    """
    project = await _get_scoped_project(project_id, principal["adminId"])
    project_with_stats = await attach_project_stats(project)
    return {"project": _serialize(project_with_stats)}


async def update_project(principal: dict, project_id: str, body: UpdateProjectBody) -> dict:
    """
    PATCH /api/admin/projects/{project_id}
    Mirrors updateProject() in adminProjectsController.js.
    """
    db = get_db()
    project = await _get_scoped_project(project_id, principal["adminId"])

    updates: dict = {"updatedAt": datetime.now(timezone.utc)}

    if body.name is not None:
        updates["name"] = body.name.strip()
    if body.clientName is not None:
        updates["clientName"] = body.clientName
    if body.clientId is not None:
        updates["clientId"] = _safe_oid(body.clientId) if body.clientId else None
    if body.contactPerson is not None:
        updates["contactPerson"] = body.contactPerson.model_dump()
    if body.description is not None:
        updates["description"] = body.description
    if body.approximateDrawingsCount is not None:
        updates["approximateDrawingsCount"] = body.approximateDrawingsCount
    if body.location is not None:
        updates["location"] = body.location
    if body.sequences is not None:
        updates["sequences"] = body.sequences
    if body.connectionDesignVendor is not None:
        updates["connectionDesignVendor"] = body.connectionDesignVendor
    if body.connectionDesignContact is not None:
        updates["connectionDesignContact"] = body.connectionDesignContact
    if body.connectionDesignEmail is not None:
        updates["connectionDesignEmail"] = body.connectionDesignEmail
    if body.status is not None:
        if body.status not in VALID_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status value.")
        updates["status"] = body.status

    await db["projects"].update_one({"_id": project["_id"]}, {"$set": updates})
    updated = await db["projects"].find_one({"_id": project["_id"]})
    return {"project": _serialize(updated)}


async def delete_project(principal: dict, project_id: str) -> dict:
    """
    DELETE /api/admin/projects/{project_id}
    Also removes associated drawings and extractions.
    Mirrors deleteProject() in adminProjectsController.js.
    """
    db = get_db()
    project = await _get_scoped_project(project_id, principal["adminId"])
    oid = project["_id"]
    name = project.get("name", "")

    await db["drawings"].delete_many({"projectId": oid})
    await db["drawingextractions"].delete_many({"projectId": oid})
    await db["projects"].delete_one({"_id": oid})

    return {"message": f'Project "{name}" and all related data deleted.'}


async def assign_user(principal: dict, project_id: str, body: AssignUserBody) -> dict:
    """
    POST /api/admin/projects/{project_id}/assignments
    Mirrors assignUser() in adminProjectsController.js.
    """
    db = get_db()
    if body.permission not in VALID_PERMISSIONS:
        raise HTTPException(status_code=400, detail="permission must be viewer, editor, or admin.")

    project = await _get_scoped_project(project_id, principal["adminId"])

    # Validate that the user belongs to this admin (cross-admin isolation)
    user_oid = _safe_oid(body.userId)
    user = await db["users"].find_one({"_id": user_oid, "adminId": ObjectId(principal["adminId"])})
    if not user:
        raise HTTPException(status_code=403, detail="User not found in your admin scope.")

    assignments = project.get("assignments", [])
    user_id_str = str(user_oid)

    # Check if already assigned → update permission
    updated = False
    for a in assignments:
        if str(a.get("userId", "")) == user_id_str:
            a["permission"] = body.permission
            updated = True
            break

    if not updated:
        assignments.append({
            "userId": user_oid,
            "username": user.get("username", ""),
            "permission": body.permission,
            "assignedAt": datetime.now(timezone.utc),
        })

    await db["projects"].update_one(
        {"_id": project["_id"]},
        {"$set": {"assignments": assignments, "updatedAt": datetime.now(timezone.utc)}}
    )
    updated_project = await db["projects"].find_one({"_id": project["_id"]})
    return {"project": _serialize(updated_project)}


async def remove_assignment(principal: dict, project_id: str, user_id: str) -> dict:
    """
    DELETE /api/admin/projects/{project_id}/assignments/{user_id}
    Mirrors removeAssignment() in adminProjectsController.js.
    """
    db = get_db()
    project = await _get_scoped_project(project_id, principal["adminId"])

    # Safety check: user must belong to this admin
    user_oid = _safe_oid(user_id)
    user = await db["users"].find_one({"_id": user_oid, "adminId": ObjectId(principal["adminId"])})
    if not user:
        raise HTTPException(status_code=403, detail="Cannot remove assignment: user not in your admin scope.")

    assignments = project.get("assignments", [])
    new_assignments = [a for a in assignments if str(a.get("userId", "")) != user_id]

    if len(new_assignments) == len(assignments):
        raise HTTPException(status_code=404, detail="Assignment not found.")

    await db["projects"].update_one(
        {"_id": project["_id"]},
        {"$set": {"assignments": new_assignments, "updatedAt": datetime.now(timezone.utc)}}
    )
    updated_project = await db["projects"].find_one({"_id": project["_id"]})
    return {"message": "Assignment removed.", "project": _serialize(updated_project)}


async def reserve_transmittal(principal: dict, project_id: str) -> dict:
    """
    POST /api/admin/projects/{project_id}/reserve-transmittal
    Atomically increments transmittalCount and returns the new number.
    """
    db = get_db()
    project = await _get_scoped_project(project_id, principal["adminId"])

    updated = await db["projects"].find_one_and_update(
        {"_id": project["_id"]},
        {"$inc": {"transmittalCount": 1}},
        return_document=True,
    )
    return {"transmittalNumber": updated.get("transmittalCount", 1)}
