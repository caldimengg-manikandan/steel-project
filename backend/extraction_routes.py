"""
============================================================
Extraction Routes  (Python equivalent of routes/extractionRoutes.js
                    + controllers/extractionController.js)
============================================================
All routes require JWT auth. Permission levels:
  - 'viewer'  → read-only
  - 'editor'  → can upload and reprocess
  - 'admin'   → can delete

Routes (all under /api/extractions/{project_id}/):
  POST   /upload            — Upload PDFs + start extraction
  POST   /check-duplicates  — Pre-flight duplicate check
  GET    /                  — List all extractions for project
  GET    /excel/download    — Download Excel report
  GET    /{id}/view         — Stream PDF from GridFS
  GET    /{id}              — Get single extraction
  POST   /{id}/reprocess    — Re-run failed extraction
  DELETE /{id}              — Delete extraction (admin only)
============================================================
"""

import asyncio
import logging
import re
from datetime import datetime, timezone
from typing import Optional, List

from bson import ObjectId
from fastapi import APIRouter, Depends, File, Form, UploadFile, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from auth_middleware import verify_token
from database import get_db
from gridfs_handler import (
    save_file_to_gridfs,
    stream_file_from_gridfs,
    delete_file_from_gridfs,
)
from extraction_pipeline import run_extraction_pipeline

logger = logging.getLogger("extraction_routes")

router = APIRouter(tags=["Extractions"])

# ── Permission Helper ────────────────────────────────────

PERMISSION_RANK = {"viewer": 1, "editor": 2, "admin": 3}


async def _scope_project_access(project_id: str, principal: dict, min_permission: str = "viewer") -> dict:
    """
    Validate that the current user has access to the given project.
    Mirrors scopeProjectAccess + requirePermission middleware from adminScope.js.
    """
    db = get_db()
    try:
        pid = ObjectId(project_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid projectId format.")

    project = await db["projects"].find_one({"_id": pid})
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")

    role = principal.get("role")
    admin_id = principal.get("adminId")

    # Admins have full access to their own projects
    if role == "admin" and str(project.get("createdByAdminId")) == admin_id:
        return project

    # Users must have an explicit assignment
    if role == "user":
        user_id = principal.get("id")
        assignment = next(
            (a for a in project.get("assignments", []) if str(a.get("userId")) == user_id),
            None,
        )
        if not assignment:
            raise HTTPException(status_code=403, detail="Access denied: not assigned to this project.")

        user_rank = PERMISSION_RANK.get(assignment.get("permission", "viewer"), 1)
        required_rank = PERMISSION_RANK.get(min_permission, 1)
        if user_rank < required_rank:
            raise HTTPException(
                status_code=403,
                detail=f"Insufficient permission: '{min_permission}' required."
            )
        return project

    raise HTTPException(status_code=403, detail="Access denied.")


def _serialize_doc(doc: dict) -> dict:
    """Convert ObjectId fields to strings in an extraction document."""
    if not doc:
        return doc
    for field in ("_id", "projectId", "createdByAdminId", "gridFsFileId"):
        if doc.get(field):
            doc[field] = str(doc[field])
    return doc


# ── Request Schemas ──────────────────────────────────────

class CheckDuplicatesBody(BaseModel):
    filenames: List[str]


# ── Routes ────────────────────────────────────────────────

@router.post("/api/extractions/{project_id}/upload", status_code=202, summary="Upload PDFs + Start Extraction")
async def upload_and_extract(
    project_id: str,
    drawings: List[UploadFile] = File(...),
    paths: Optional[str] = Form(None),
    localSavePath: Optional[str] = Form(""),
    targetTransmittalNumber: Optional[str] = Form(None),
    sequences: Optional[str] = Form(None),
    principal: dict = Depends(verify_token),
):
    """
    POST /api/extractions/{project_id}/upload
    Accepts multiple PDF files, saves to GridFS, queues extraction.
    Mirrors uploadAndExtract() in extractionController.js.
    """
    await _scope_project_access(project_id, principal, "editor")
    db = get_db()

    admin_id = principal["adminId"]
    uploaded_by = principal["username"]

    target_transmittal_number: Optional[int] = None
    if targetTransmittalNumber and targetTransmittalNumber.strip():
        try:
            target_transmittal_number = int(targetTransmittalNumber)
        except ValueError:
            pass

    seq_list = []
    if sequences:
        import json
        try:
            seq_list = json.loads(sequences) if sequences.startswith("[") else [sequences]
        except Exception:
            seq_list = []

    path_list = []
    if paths:
        import json
        try:
            path_list = json.loads(paths) if paths.startswith("[") else [paths]
        except Exception:
            path_list = [paths]

    # Binder pattern filter (matches Node: skip any file with 'binder' in path)
    BINDER_PATTERN = re.compile(r"\bbinder(s|[\s_\-]?sheet)?\b", re.IGNORECASE)

    valid_uploads = []
    for i, file in enumerate(drawings):
        full_path = path_list[i] if i < len(path_list) else (file.filename or "")

        if BINDER_PATTERN.search(full_path):
            logger.info(f"[Upload] Skipping Binder file: '{full_path}'")
            continue

        # Extract folder name from path
        folder_name = "DRAWINGS"
        if "/" in full_path:
            parts = full_path.split("/")
            folder_name = parts[-2] if len(parts) > 1 else "DRAWINGS"
        elif "\\" in full_path:
            parts = full_path.split("\\")
            folder_name = parts[-2] if len(parts) > 1 else "DRAWINGS"

        valid_uploads.append((file, folder_name))

    if not valid_uploads:
        return {
            "message": "All files inside binders were skipped.",
            "extractionIds": [],
            "status": "skipped",
        }

    extraction_ids = []
    tasks = []

    for file, folder_name in valid_uploads:
        content = await file.read()
        original_name = file.filename or "unknown.pdf"

        if file.content_type and "pdf" not in file.content_type.lower():
            raise HTTPException(status_code=400, detail=f"Only PDF files accepted: {original_name}")

        # Save to GridFS
        gridfs_id = await save_file_to_gridfs(
            file_bytes=content,
            original_filename=original_name,
            content_type="application/pdf",
            project_id=project_id,
            admin_id=admin_id,
            field_type="drawings",
        )

        now = datetime.now(timezone.utc)
        doc = {
            "projectId": ObjectId(project_id),
            "createdByAdminId": ObjectId(admin_id),
            "originalFileName": original_name,
            "fileUrl": "",
            "gridFsFileId": ObjectId(gridfs_id),
            "folderName": folder_name,
            "fileSize": len(content),
            "uploadedBy": uploaded_by,
            "localSavePath": localSavePath or "",
            "targetTransmittalNumber": target_transmittal_number,
            "sequences": seq_list,
            "status": "queued",
            "errorMessage": "",
            "extractionConfidence": 0,
            "processingTimeMs": 0,
            "extractedFields": {},
            "validationResult": {},
            "excelPath": "",
            "excelUrl": "",
            "createdAt": now,
            "updatedAt": now,
        }

        result = await db["drawing_extractions"].insert_one(doc)
        eid = str(result.inserted_id)
        extraction_ids.append(eid)

        # Queue background extraction
        tasks.append(asyncio.create_task(
            run_extraction_pipeline(eid, gridfs_id, project_id, target_transmittal_number)
        ))

    return {
        "message": f"{len(valid_uploads)} file(s) queued for extraction.",
        "extractionIds": extraction_ids,
        "status": "queued",
    }


@router.post("/api/extractions/{project_id}/check-duplicates", summary="Check for Duplicate Drawings")
async def check_duplicates(
    project_id: str,
    body: CheckDuplicatesBody,
    principal: dict = Depends(verify_token),
):
    """
    POST /api/extractions/{project_id}/check-duplicates
    Mirrors checkDuplicates() in extractionController.js.
    """
    await _scope_project_access(project_id, principal, "viewer")
    db = get_db()

    if not body.filenames:
        raise HTTPException(status_code=400, detail="filenames array is required.")

    existing = await db["drawing_extractions"].find(
        {"projectId": ObjectId(project_id), "status": "completed"},
        {"originalFileName": 1, "extractedFields": 1}
    ).to_list(None)

    by_filename = {e["originalFileName"]: e for e in existing}

    duplicates = []
    for fname in body.filenames:
        match = by_filename.get(fname)
        if match:
            ef = match.get("extractedFields") or {}
            duplicates.append({
                "filename": fname,
                "sheetNumber": ef.get("drawingNumber", ""),
                "revision": ef.get("revision", ""),
            })

    return {
        "hasDuplicates": len(duplicates) > 0,
        "duplicateCount": len(duplicates),
        "duplicates": duplicates,
    }


@router.get("/api/extractions/{project_id}", summary="List Extractions")
async def list_extractions(
    project_id: str,
    principal: dict = Depends(verify_token),
):
    """
    GET /api/extractions/{project_id}
    Mirrors listExtractions() in extractionController.js.
    """
    await _scope_project_access(project_id, principal, "viewer")
    db = get_db()

    cursor = db["drawing_extractions"].find(
        {"projectId": ObjectId(project_id)}
    ).sort("createdAt", -1)
    extractions = await cursor.to_list(None)
    serialized = [_serialize_doc(e) for e in extractions]

    has_excel = any(e.get("excelUrl") for e in serialized)
    excel_url = f"/api/extractions/{project_id}/excel/download" if has_excel else None

    return {"extractions": serialized, "hasExcel": has_excel, "excelDownloadUrl": excel_url}


@router.get("/api/extractions/{project_id}/excel/download", summary="Download Excel Report")
async def download_excel(
    project_id: str,
    type: Optional[str] = Query(None),
    principal: dict = Depends(verify_token),
):
    """
    GET /api/extractions/{project_id}/excel/download
    Mirrors downloadExcel() in extractionController.js.
    Phase 5 (excel_generator.py) completes this endpoint.
    """
    await _scope_project_access(project_id, principal, "viewer")
    db = get_db()

    extractions = await db["drawing_extractions"].find(
        {"projectId": ObjectId(project_id), "status": "completed"}
    ).sort("createdAt", 1).to_list(None)

    if not extractions:
        raise HTTPException(status_code=404, detail="No completed extractions found for this project.")

    project = await db["projects"].find_one({"_id": ObjectId(project_id)})
    project_details = {
        "projectName": project.get("name", "Project") if project else "Project",
        "clientName": project.get("clientName", "Unknown Client") if project else "Unknown Client",
        "transmittalNo": project.get("transmittalCount", 1) if project else 1,
    }

    try:
        from excel_generator import generate_project_excel
        buffer, filename = generate_project_excel(extractions, project_details, type)
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="Excel generator (Phase 5) not yet migrated. Use the Node.js endpoint for now."
        )

    return Response(
        content=buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/api/extractions/{project_id}/{extraction_id}/view", summary="Stream PDF from GridFS")
async def view_pdf(
    project_id: str,
    extraction_id: str,
    principal: dict = Depends(verify_token),
):
    """
    GET /api/extractions/{project_id}/{extraction_id}/view
    Mirrors viewPdf() in extractionController.js.
    """
    await _scope_project_access(project_id, principal, "viewer")
    db = get_db()

    doc = await db["drawing_extractions"].find_one(
        {"_id": ObjectId(extraction_id), "projectId": ObjectId(project_id)}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Extraction not found.")

    if doc.get("gridFsFileId"):
        return await stream_file_from_gridfs(
            str(doc["gridFsFileId"]),
            doc.get("originalFileName", "drawing.pdf"),
            inline=True,
        )

    raise HTTPException(status_code=404, detail="Physical PDF file not found.")


@router.get("/api/extractions/{project_id}/{extraction_id}", summary="Get Single Extraction")
async def get_extraction(
    project_id: str,
    extraction_id: str,
    principal: dict = Depends(verify_token),
):
    """
    GET /api/extractions/{project_id}/{extraction_id}
    Mirrors getExtraction() in extractionController.js.
    """
    await _scope_project_access(project_id, principal, "viewer")
    db = get_db()

    doc = await db["drawing_extractions"].find_one(
        {"_id": ObjectId(extraction_id), "projectId": ObjectId(project_id)}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Extraction not found.")
    return _serialize_doc(doc)


@router.post("/api/extractions/{project_id}/{extraction_id}/reprocess", summary="Reprocess Extraction")
async def reprocess(
    project_id: str,
    extraction_id: str,
    principal: dict = Depends(verify_token),
):
    """
    POST /api/extractions/{project_id}/{extraction_id}/reprocess
    Mirrors reprocess() in extractionController.js.
    """
    await _scope_project_access(project_id, principal, "editor")
    db = get_db()

    doc = await db["drawing_extractions"].find_one(
        {"_id": ObjectId(extraction_id), "projectId": ObjectId(project_id)}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Extraction not found.")

    if not doc.get("gridFsFileId"):
        raise HTTPException(status_code=400, detail="No GridFS file found. Please re-upload.")

    # Reset status
    await db["drawing_extractions"].update_one(
        {"_id": ObjectId(extraction_id)},
        {"$set": {
            "status": "queued",
            "errorMessage": "",
            "extractedFields": {},
            "extractionConfidence": 0,
            "updatedAt": datetime.now(timezone.utc),
        }},
    )

    # Fire and forget
    asyncio.create_task(
        run_extraction_pipeline(
            extraction_id,
            str(doc["gridFsFileId"]),
            project_id,
            doc.get("targetTransmittalNumber"),
        )
    )

    return {"message": "Reprocessing started.", "status": "queued"}


@router.delete("/api/extractions/{project_id}/{extraction_id}", summary="Delete Extraction")
async def delete_extraction(
    project_id: str,
    extraction_id: str,
    principal: dict = Depends(verify_token),
):
    """
    DELETE /api/extractions/{project_id}/{extraction_id}
    Mirrors deleteExtraction() in extractionController.js.
    """
    await _scope_project_access(project_id, principal, "admin")
    db = get_db()

    doc = await db["drawing_extractions"].find_one_and_delete(
        {"_id": ObjectId(extraction_id), "projectId": ObjectId(project_id)}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Extraction not found.")

    # Delete from GridFS
    if doc.get("gridFsFileId"):
        await delete_file_from_gridfs(str(doc["gridFsFileId"]))

    return {"message": "Extraction deleted."}
