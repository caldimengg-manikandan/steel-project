"""
============================================================
Extraction Pipeline  (Python equivalent of extractionService.js)
============================================================
The **KEY ADVANTAGE** of this migration:

  Old (Node.js):  spawn("python3", ["extract_drawing.py", pdfPath])
    wait for stdout JSON → parse → save to DB

  New (FastAPI):  import extract_drawing; call extract_pdf(path)
    result directly in memory → save to DB

  No child processes. No stdout parsing. No 10-minute timeouts.
  The Python script is now a first-class module.

Pipeline steps:
  1. Mark extraction as 'processing'
  2. Download PDF from GridFS to a temp file
  3. Call extract_drawing.extract_pdf() DIRECTLY (same process!)
  4. Save results to MongoDB
  5. Sync project's approximateDrawingsCount
  6. Trigger async Excel batch write
============================================================
"""

import asyncio
import logging
import os
import sys
import tempfile
import importlib
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional
from bson import ObjectId

from database import get_db
from gridfs_handler import download_file_from_gridfs

logger = logging.getLogger("extraction_pipeline")

# Add scripts directory to path so we can import extract_drawing directly
_SCRIPTS_DIR = Path(__file__).parent / "src" / "scripts"
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

# ── Concurrency Control ───────────────────────────────────
MAX_CONCURRENCY = 10
_semaphore = asyncio.Semaphore(MAX_CONCURRENCY)

# ── Excel batch buffer ────────────────────────────────────
# projectId -> list of row dicts to write
_excel_buffer: dict[str, list] = {}
_excel_locks: dict[str, asyncio.Lock] = {}


def _get_excel_lock(project_id: str) -> asyncio.Lock:
    if project_id not in _excel_locks:
        _excel_locks[project_id] = asyncio.Lock()
    return _excel_locks[project_id]


# ── Direct Python Import (The Key Benefit!) ───────────────

def _call_extractor(pdf_path: str, original_filename: str = "") -> dict:
    """
    Call extract_drawing.extract_pdf() DIRECTLY — no subprocess spawn.
    This replaces _callPythonBridge() which spawned python3 as a child process.

    Returns the same dict structure: { success, fields, validation, confidence }
    """
    try:
        # Dynamically import so it reloads if the script changes during dev
        if "extract_drawing" in sys.modules:
            extract_mod = sys.modules["extract_drawing"]
        else:
            import importlib
            extract_mod = importlib.import_module("extract_drawing")

        result = extract_mod.extract_pdf(pdf_path, original_filename=original_filename)
        return result

    except ImportError as e:
        logger.error(f"[Extractor] Failed to import extract_drawing: {e}")
        return {"success": False, "error": f"Import error: {e}"}
    except Exception as e:
        logger.error(f"[Extractor] extract_pdf raised: {e}")
        return {"success": False, "error": str(e)}


# ── Main Pipeline ─────────────────────────────────────────

async def run_extraction_pipeline(
    extraction_id: str,
    gridfs_file_id: str,
    project_id: str,
    target_transmittal_number: Optional[int] = None,
):
    """
    Full extraction pipeline for one uploaded PDF.
    Queued via asyncio tasks — replaces the Node extractionQueue.
    Mirrors _executePipeline() in extractionService.js.
    """
    async with _semaphore:
        await _execute_pipeline(
            extraction_id,
            gridfs_file_id,
            project_id,
            target_transmittal_number,
        )


async def _execute_pipeline(
    extraction_id: str,
    gridfs_file_id: str,
    project_id: str,
    target_transmittal_number: Optional[int],
):
    db = get_db()
    start = datetime.now(timezone.utc)
    tmp_path = None

    try:
        eid = ObjectId(extraction_id)

        # Step 1: Mark as processing
        extraction_doc = await db["drawing_extractions"].find_one_and_update(
            {"_id": eid},
            {"$set": {"status": "processing", "errorMessage": ""}},
            return_document=True,
        )
        if not extraction_doc:
            logger.error(f"[Pipeline] Extraction doc {extraction_id} not found in DB.")
            return

        original_filename = extraction_doc.get("originalFileName", "unknown.pdf")
        logger.info(f"[Pipeline] Processing '{original_filename}' (ID={extraction_id})")

        # Step 2: Download from GridFS to a temp file
        pdf_bytes = await download_file_from_gridfs(gridfs_file_id)

        # Write to a named temp file so the extractor can open it
        suffix = Path(original_filename).suffix or ".pdf"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(pdf_bytes)
            tmp_path = tmp.name

        logger.info(f"[Pipeline] GridFS file written to temp: {tmp_path}")

        # Step 3: Call extractor DIRECTLY (no subprocess!)
        result = await asyncio.get_event_loop().run_in_executor(
            None,  # use default thread pool
            _call_extractor,
            tmp_path,
            original_filename,
        )

        # Cleanup temp file immediately
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
            tmp_path = None

        if not result.get("success"):
            raise RuntimeError(result.get("error") or "Extraction returned failure")

        fields = result.get("fields", {})
        validation = result.get("validation", {})
        confidence = result.get("confidence", 0)
        processing_ms = int((datetime.now(timezone.utc) - start).total_seconds() * 1000)

        # Step 4: Save result to MongoDB
        updated_doc = await db["drawing_extractions"].find_one_and_update(
            {"_id": eid},
            {
                "$set": {
                    "status": "completed",
                    "extractedFields": fields,
                    "validationResult": validation,
                    "extractionConfidence": confidence,
                    "processingTimeMs": processing_ms,
                    "errorMessage": "",
                    "updatedAt": datetime.now(timezone.utc),
                }
            },
            return_document=True,
        )

        logger.info(
            f"[Pipeline] ✓ '{original_filename}' — "
            f"confidence={confidence * 100:.0f}% — {processing_ms}ms"
        )

        # Step 5: Sync project approximateDrawingsCount
        await _sync_project_count(project_id, fields, extraction_id, db)

        # Step 6: Buffer for Excel batch write
        _buffer_excel_row(
            project_id=project_id,
            fields=fields,
            confidence=confidence,
            updated_doc=updated_doc,
            target_transmittal_number=target_transmittal_number,
            extraction_id=extraction_id,
        )

        # Trigger background Excel flush (non-blocking)
        asyncio.create_task(_flush_excel_queue(project_id))

    except Exception as e:
        processing_ms = int((datetime.now(timezone.utc) - start).total_seconds() * 1000)
        logger.error(f"[Pipeline] ✗ {extraction_id}: {e}")

        # Cleanup temp on error
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

        try:
            db = get_db()
            await db["drawing_extractions"].update_one(
                {"_id": ObjectId(extraction_id)},
                {
                    "$set": {
                        "status": "failed",
                        "errorMessage": str(e),
                        "processingTimeMs": processing_ms,
                        "updatedAt": datetime.now(timezone.utc),
                    }
                },
            )
        except Exception as db_err:
            logger.critical(f"[Pipeline] CRITICAL: Failed to update error status: {db_err}")


async def _sync_project_count(project_id: str, fields: dict, extraction_id: str, db):
    """
    Ensure approximateDrawingsCount reflects reality.
    Mirrors Steps 5b and 5c in _executePipeline() of extractionService.js.
    """
    try:
        pid_oid = ObjectId(project_id)

        unique_sheets = await db["drawing_extractions"].distinct(
            "extractedFields.drawingNumber",
            {
                "projectId": pid_oid,
                "status": "completed",
                "extractedFields.drawingNumber": {"$ne": None, "$nin": [""]},
            },
        )
        total_files = await db["drawing_extractions"].count_documents(
            {"projectId": pid_oid, "status": "completed"}
        )
        target_count = max(len(unique_sheets), total_files)

        result = await db["projects"].update_one(
            {"_id": pid_oid, "approximateDrawingsCount": {"$lt": target_count}},
            {"$set": {"approximateDrawingsCount": target_count}},
        )
        if result.modified_count > 0:
            logger.info(f"[Pipeline] Synced approx count for {project_id} → {target_count}")
    except Exception as e:
        logger.error(f"[Pipeline] Error syncing count: {e}")


def _buffer_excel_row(
    project_id: str,
    fields: dict,
    confidence: float,
    updated_doc: dict,
    target_transmittal_number: Optional[int],
    extraction_id: str,
):
    """Buffer a row for batch Excel write — matches _flushExcelQueue logic."""
    if project_id not in _excel_buffer:
        _excel_buffer[project_id] = []

    _excel_buffer[project_id].append({
        "drawingNumber": fields.get("drawingNumber"),
        "drawingTitle": fields.get("drawingTitle"),
        "description": fields.get("description"),
        "drawingDescription": fields.get("drawingDescription"),
        "revision": fields.get("revision"),
        "date": fields.get("date"),
        "remarks": fields.get("remarks"),
        "revisionHistory": fields.get("revisionHistory", []),
        "scale": fields.get("scale"),
        "projectName": fields.get("projectName"),
        "clientName": fields.get("clientName"),
        "fileName": updated_doc.get("originalFileName") if updated_doc else "",
        "confidence": confidence,
        "uploadedBy": updated_doc.get("uploadedBy") if updated_doc else "",
        "uploadDate": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "extractionId": extraction_id,
        "targetTransmittalNumber": target_transmittal_number,
    })


async def _flush_excel_queue(project_id: str):
    """
    Batch-write buffered rows to the project Excel file.
    Ensures only one write happens per project at a time.
    Mirrors _flushExcelQueue() in extractionService.js.
    """
    lock = _get_excel_lock(project_id)
    async with lock:
        rows = _excel_buffer.pop(project_id, [])
        if not rows:
            return

        try:
            from excel_generator import append_rows_to_project_excel   # Phase 5
            db = get_db()

            excel_path = await asyncio.get_event_loop().run_in_executor(
                None, append_rows_to_project_excel, project_id, rows
            )

            ids = [ObjectId(r["extractionId"]) for r in rows]
            await db["drawing_extractions"].update_many(
                {"_id": {"$in": ids}},
                {
                    "$set": {
                        "excelPath": excel_path,
                        "excelUrl": f"/api/extractions/{project_id}/excel/download",
                    }
                },
            )
            logger.info(f"[Excel] Batch wrote {len(rows)} rows for project {project_id}")
        except ImportError:
            # Phase 5 not yet migrated — skip gracefully
            logger.debug("[Excel] excel_generator not yet available (Phase 5 pending)")
        except Exception as e:
            logger.error(f"[Excel] Batch write failed for {project_id}: {e}")


# ── Startup Recovery ──────────────────────────────────────

async def resume_extractions():
    """
    On startup: re-queue any items stuck in 'queued' or 'processing' state.
    Mirrors resumeExtractions() in extractionService.js.
    """
    db = get_db()
    try:
        cursor = db["drawing_extractions"].find(
            {"status": {"$in": ["queued", "processing"]}}
        )
        stuck = await cursor.to_list(None)
        if stuck:
            logger.info(f"[Queue] Resuming {len(stuck)} unfinished extractions.")
            for doc in stuck:
                gridfs_id = str(doc.get("gridFsFileId", ""))
                if gridfs_id:
                    asyncio.create_task(
                        run_extraction_pipeline(
                            str(doc["_id"]),
                            gridfs_id,
                            str(doc.get("projectId", "")),
                            doc.get("targetTransmittalNumber"),
                        )
                    )
    except Exception as e:
        logger.error(f"[Queue] Startup sweep failed: {e}")


async def cleanup_stuck_processes():
    """
    Mark items stuck in 'processing' for >15 minutes as 'failed'.
    Mirrors cleanupStuckProcesses() in extractionService.js.
    """
    db = get_db()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=15)
        result = await db["drawing_extractions"].update_many(
            {"status": "processing", "updatedAt": {"$lt": cutoff}},
            {
                "$set": {
                    "status": "failed",
                    "errorMessage": "Processing timed out after 15 minutes of inactivity.",
                }
            },
        )
        if result.modified_count > 0:
            logger.info(f"[Queue] Cleaned up {result.modified_count} stuck processing records.")
    except Exception as e:
        logger.error(f"[Queue] Cleanup failed: {e}")
