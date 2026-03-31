"""
============================================================
Transmittal Routes  (Python equivalent of routes/transmittalRoutes.js
                     + controllers/transmittalController.js)
============================================================
All routes under /api/transmittals/{project_id}/

POST   /generate             — Generate a new transmittal
POST   /preview-changes      — Dry-run change detection
GET    /                     — List all transmittals
GET    /drawing-log          — Get the Drawing Log (JSON)
GET    /drawing-log/excel    — Download Drawing Log as Excel
GET    /{transmittal_id}/excel — Download a specific Transmittal as Excel
GET    /{transmittal_id}     — Get a single transmittal
DELETE /{transmittal_id}     — Delete a transmittal
============================================================
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional, List

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel

from auth_middleware import verify_token
from database import get_db
from transmittal_service import (
    generate_transmittal,
    get_transmittals,
    get_drawing_log,
    detect_changes,
)
from excel_generator import generate_project_excel

logger = logging.getLogger("transmittal_routes")

router = APIRouter(tags=["Transmittals"])

# ── Permission helper (reuses extraction_routes logic) ───

PERMISSION_RANK = {"viewer": 1, "editor": 2, "admin": 3}


async def _scope_project_access(project_id: str, principal: dict, min_permission: str = "viewer") -> dict:
    db = get_db()
    try:
        pid = ObjectId(project_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid projectId format.")

    project = await db["projects"].find_one({"_id": pid})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")

    role     = principal.get("role")
    admin_id = principal.get("adminId")

    if role == "admin" and str(project.get("createdByAdminId")) == admin_id:
        return project

    if role == "user":
        user_id    = principal.get("id")
        assignment = next(
            (a for a in project.get("assignments", []) if str(a.get("userId")) == user_id),
            None,
        )
        if not assignment:
            raise HTTPException(status_code=403, detail="Not assigned to this project.")
        user_rank = PERMISSION_RANK.get(assignment.get("permission", "viewer"), 1)
        if user_rank < PERMISSION_RANK.get(min_permission, 1):
            raise HTTPException(status_code=403, detail=f"'{min_permission}' permission required.")
        return project

    raise HTTPException(status_code=403, detail="Access denied.")


def _serialize(doc: dict) -> dict:
    if not doc:
        return doc
    for f in ("_id", "projectId", "createdByAdminId"):
        if doc.get(f) and not isinstance(doc[f], str):
            doc[f] = str(doc[f])
    return doc


# ── Request Schemas ──────────────────────────────────────

class GenerateTransmittalBody(BaseModel):
    extractionIds: Optional[List[str]] = None
    targetTransmittalNumber: Optional[int] = None


class PreviewChangesBody(BaseModel):
    extractionIds: Optional[List[str]] = None
    targetTransmittalNumber: Optional[int] = None


# ── Routes ────────────────────────────────────────────────

@router.post("/api/transmittals/{project_id}/generate", status_code=201, summary="Generate Transmittal")
async def route_generate_transmittal(
    project_id: str,
    body: GenerateTransmittalBody,
    principal: dict = Depends(verify_token),
):
    """
    POST /api/transmittals/{project_id}/generate
    Mirrors generateTransmittal() in transmittalController.js.
    """
    await _scope_project_access(project_id, principal, "editor")
    db = get_db()
    pid = ObjectId(project_id)

    # Determine target transmittal numbers to process
    target_numbers: list = []

    if body.targetTransmittalNumber is not None:
        target_numbers = [body.targetTransmittalNumber]
    elif body.extractionIds:
        exts = await db["drawing_extractions"].find(
            {"_id": {"$in": [ObjectId(eid) for eid in body.extractionIds]}, "projectId": pid},
            {"targetTransmittalNumber": 1}
        ).to_list(None)
        nums = list(set(e.get("targetTransmittalNumber") for e in exts if e.get("targetTransmittalNumber") is not None))
        target_numbers = nums if nums else [None]
    else:
        # All pending groups
        pending = await db["drawing_extractions"].aggregate([
            {"$match": {"projectId": pid, "status": "completed", "targetTransmittalNumber": {"$ne": None}}},
            {"$group": {"_id": "$targetTransmittalNumber"}},
            {"$sort": {"_id": 1}},
        ]).to_list(None)
        target_numbers = [p["_id"] for p in pending] or [None]

    results = []
    last_result = None

    for target_num in target_numbers:
        result = await generate_transmittal(
            project_id,
            principal["adminId"],
            body.extractionIds if body.extractionIds else None,
            target_num,
        )
        last_result = result
        if result.get("transmittal"):
            results.append(result)

    if not results:
        summary = (last_result or {}).get("summary") or {}
        return {
            "message": summary.get("message") or "No new or revised drawings detected.",
            "transmittal": None,
            "summary": summary,
        }

    tr_nums = ", ".join(
        f"TR-{str(r['summary']['transmittalNumber']).zfill(3)}"
        for r in results
    )
    last = results[-1]
    return {
        "message": f"{tr_nums} generated successfully.",
        "transmittal": last["transmittal"],
        "drawingLog": last.get("drawingLog"),
        "summary": last["summary"],
        "allResults": [r["summary"] for r in results],
    }


@router.post("/api/transmittals/{project_id}/preview-changes", summary="Preview Transmittal Changes")
async def route_preview_changes(
    project_id: str,
    body: PreviewChangesBody,
    principal: dict = Depends(verify_token),
):
    """
    POST /api/transmittals/{project_id}/preview-changes
    Dry-run change detection — no side effects.
    Mirrors previewChanges() in transmittalController.js.
    """
    await _scope_project_access(project_id, principal, "viewer")
    db = get_db()
    pid = ObjectId(project_id)

    ext_filter: dict = {"projectId": pid, "status": "completed"}
    if body.extractionIds:
        ext_filter["_id"] = {"$in": [ObjectId(eid) for eid in body.extractionIds]}
    if body.targetTransmittalNumber is not None:
        ext_filter["targetTransmittalNumber"] = body.targetTransmittalNumber

    extractions = await db["drawing_extractions"].find(ext_filter).to_list(None)
    log = await db["drawing_logs"].find_one({"projectId": pid})

    changes = detect_changes(extractions, log)
    new_dwgs    = changes["newDrawings"]
    revised_dwgs = changes["revisedDrawings"]
    unchanged   = changes["unchangedDrawings"]

    return {
        "newCount":       len(new_dwgs),
        "revisedCount":   len(revised_dwgs),
        "unchangedCount": len(unchanged),
        "newDrawings": [
            {
                "drawingNumber": (e.get("extractedFields") or {}).get("drawingNumber") or "",
                "revision":      (e.get("extractedFields") or {}).get("revision") or "",
                "title":         (e.get("extractedFields") or {}).get("drawingTitle") or e.get("originalFileName"),
            }
            for e in new_dwgs
        ],
        "revisedDrawings": [
            {
                "drawingNumber":   (e.get("extractedFields") or {}).get("drawingNumber") or "",
                "revision":        (e.get("extractedFields") or {}).get("revision") or "",
                "previousRevision": e.get("_previousRevision") or "",
                "title":           (e.get("extractedFields") or {}).get("drawingTitle") or e.get("originalFileName"),
            }
            for e in revised_dwgs
        ],
    }


@router.get("/api/transmittals/{project_id}", summary="List Transmittals")
async def route_list_transmittals(
    project_id: str,
    principal: dict = Depends(verify_token),
):
    """
    GET /api/transmittals/{project_id}
    Mirrors listTransmittals() in transmittalController.js.
    Also includes in-flight (pending) transmittal numbers.
    """
    await _scope_project_access(project_id, principal, "viewer")
    db = get_db()
    pid = ObjectId(project_id)

    transmittals = await get_transmittals(project_id)

    # Include in-flight transmittals (pending extraction groups)
    try:
        pending_targets = await db["drawing_extractions"].aggregate([
            {"$match": {"projectId": pid, "targetTransmittalNumber": {"$ne": None}}},
            {"$group": {"_id": "$targetTransmittalNumber", "count": {"$sum": 1}, "sequences": {"$push": "$sequences"}}},
        ]).to_list(None)

        existing_numbers = {t.get("transmittalNumber") for t in transmittals}

        for target in pending_targets:
            num = target["_id"]
            if num not in existing_numbers:
                pending_seqs: set = set()
                for seq_arr in target.get("sequences", []):
                    if isinstance(seq_arr, list):
                        pending_seqs.update(seq_arr)
                transmittals.insert(0, {
                    "_id": f"pending-{num}",
                    "transmittalNumber": num,
                    "newCount": target["count"],
                    "revisedCount": 0,
                    "createdAt": datetime.now(timezone.utc),
                    "isPending": True,
                    "sequences": list(pending_seqs),
                })
    except Exception as e:
        logger.warning(f"[ListTransmittals] Failed to load pending targets: {e}")

    transmittals.sort(key=lambda t: t.get("transmittalNumber") or 0, reverse=True)
    return {"count": len(transmittals), "transmittals": transmittals}


@router.get("/api/transmittals/{project_id}/drawing-log", summary="Get Drawing Log")
async def route_get_drawing_log(
    project_id: str,
    principal: dict = Depends(verify_token),
):
    """GET /api/transmittals/{project_id}/drawing-log"""
    await _scope_project_access(project_id, principal, "viewer")
    log = await get_drawing_log(project_id)
    if not log:
        raise HTTPException(
            status_code=404,
            detail="Drawing Log not found. Please generate a transmittal first."
        )
    return {"drawingLog": log}


@router.get("/api/transmittals/{project_id}/drawing-log/excel", summary="Download Drawing Log Excel")
async def route_download_drawing_log_excel(
    project_id: str,
    principal: dict = Depends(verify_token),
):
    """GET /api/transmittals/{project_id}/drawing-log/excel"""
    await _scope_project_access(project_id, principal, "viewer")
    db = get_db()

    log = await get_drawing_log(project_id)
    if not log or not log.get("drawings"):
        raise HTTPException(status_code=404, detail="Drawing Log is empty or not found.")

    project = await db["projects"].find_one({"_id": ObjectId(project_id)})
    project_details = {
        "projectName": project.get("name", "Project") if project else "Project",
        "clientName":  project.get("clientName", "CLIENT") if project else "CLIENT",
    }

    # Use the drawing log entries as rows for the Log sheet
    buffer, filename = generate_project_excel(
        log.get("drawings", []), project_details, sheet_type="log"
    )
    return Response(
        content=buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/api/transmittals/{project_id}/{transmittal_id}/excel", summary="Download Transmittal Excel")
async def route_download_transmittal_excel(
    project_id: str,
    transmittal_id: str,
    principal: dict = Depends(verify_token),
):
    """GET /api/transmittals/{project_id}/{transmittal_id}/excel"""
    await _scope_project_access(project_id, principal, "viewer")
    db = get_db()

    transmittal = await db["transmittals"].find_one({
        "_id":       ObjectId(transmittal_id),
        "projectId": ObjectId(project_id),
    })
    if not transmittal:
        raise HTTPException(status_code=404, detail="Transmittal not found.")

    project = await db["projects"].find_one({"_id": ObjectId(project_id)})
    project_details = {
        "projectName":   project.get("name", "Project") if project else "Project",
        "clientName":    project.get("clientName", "CLIENT") if project else "CLIENT",
        "transmittalNo": transmittal.get("transmittalNumber", 1),
    }

    # Pass transmittal drawings as rows
    rows = [
        {
            "extractedFields": {
                "drawingNumber": d.get("drawingNumber"),
                "drawingTitle":  d.get("drawingTitle"),
                "revision":      d.get("revision"),
                "date":          d.get("date"),
                "remarks":       d.get("remarks"),
            },
            "folderName":     d.get("folderName"),
            "originalFileName": d.get("originalFileName"),
        }
        for d in (transmittal.get("drawings") or [])
    ]

    buffer, filename = generate_project_excel(rows, project_details, sheet_type="transmittal")
    return Response(
        content=buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/api/transmittals/{project_id}/{transmittal_id}", summary="Get Single Transmittal")
async def route_get_transmittal(
    project_id: str,
    transmittal_id: str,
    principal: dict = Depends(verify_token),
):
    """GET /api/transmittals/{project_id}/{transmittal_id}"""
    await _scope_project_access(project_id, principal, "viewer")
    db = get_db()

    doc = await db["transmittals"].find_one({
        "_id":       ObjectId(transmittal_id),
        "projectId": ObjectId(project_id),
    })
    if not doc:
        raise HTTPException(status_code=404, detail="Transmittal not found.")
    return {"transmittal": _serialize(dict(doc))}


@router.delete("/api/transmittals/{project_id}/{transmittal_id}", summary="Delete Transmittal")
async def route_delete_transmittal(
    project_id: str,
    transmittal_id: str,
    principal: dict = Depends(verify_token),
):
    """DELETE /api/transmittals/{project_id}/{transmittal_id}"""
    await _scope_project_access(project_id, principal, "admin")
    db = get_db()

    doc = await db["transmittals"].find_one_and_delete({
        "_id":       ObjectId(transmittal_id),
        "projectId": ObjectId(project_id),
    })
    if not doc:
        raise HTTPException(status_code=404, detail="Transmittal not found.")

    tr_num = doc.get("transmittalNumber", 0)
    return {"message": f"Transmittal TR-{str(tr_num).zfill(3)} deleted."}
