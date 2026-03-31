"""
============================================================
Transmittal Service  (Python equivalent of services/transmittalService.js)
============================================================
Core logic for:
  1. Detecting new vs revised vs unchanged drawings
  2. Generating a numbered Transmittal record
  3. Incrementally updating the Drawing Log

Key design principles (same as Node version):
  - Idempotent: same input → same classification
  - Non-destructive: Drawing Log is never reset
  - Revision-aware: fabrication (numeric) beats approval (alpha)
  - Per-project async locking to avoid race conditions
============================================================
"""

import asyncio
import logging
import re
from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId

from database import get_db
from excel_generator import pick_latest_revision, normalize_revision

logger = logging.getLogger("transmittal_service")

# Per-project async locks (mirrors extractionLocks Map in Node)
_project_locks: dict[str, asyncio.Lock] = {}


def _get_project_lock(project_id: str) -> asyncio.Lock:
    if project_id not in _project_locks:
        _project_locks[project_id] = asyncio.Lock()
    return _project_locks[project_id]


# ── Revision Helpers ─────────────────────────────────────

def _revision_rank(rev: str) -> int:
    norm = normalize_revision(rev)
    if not norm:
        return -1
    try:
        return 10000 + int(norm)   # fabrication tier
    except ValueError:
        return ord(norm[0])         # approval tier


def compare_revisions(a: str, b: str) -> int:
    return _revision_rank(a) - _revision_rank(b)


def _get_mark(entry: dict) -> str:
    return entry.get("mark") or entry.get("revision") or ""


# ── Change Detection ──────────────────────────────────────

def detect_changes(extractions: list, drawing_log: Optional[dict]) -> dict:
    """
    Classify each extraction as new / revised / unchanged.
    Mirrors detectChanges() in transmittalService.js.
    """
    log_map: dict[str, dict] = {}
    title_map: dict[str, dict] = {}

    if drawing_log and isinstance(drawing_log.get("drawings"), list):
        for entry in drawing_log["drawings"]:
            num_key   = (entry.get("drawingNumber") or "").strip().upper()
            title_key = (entry.get("drawingTitle") or entry.get("description") or "").strip().upper()
            rev_norm  = normalize_revision(entry.get("currentRevision") or "")
            if num_key:
                log_map[num_key] = {"rev": rev_norm, "origNum": (entry.get("drawingNumber") or "").strip()}
            if title_key:
                title_map[title_key] = {"rev": rev_norm, "origNum": (entry.get("drawingNumber") or "").strip()}

    new_drawings       = []
    revised_drawings   = []
    unchanged_drawings = []

    for ext in extractions:
        f = ext.get("extractedFields") or {}
        drawing_number = (f.get("drawingNumber") or "").strip().upper()
        drawing_title  = (f.get("drawingTitle") or f.get("drawingDescription") or "").strip().upper()

        rev_hist = (f.get("revisionHistory") or []) if isinstance(f.get("revisionHistory"), list) else []
        if not rev_hist:
            rev_hist = [{"mark": f.get("revision"), "date": f.get("date"), "remarks": f.get("remarks")}]

        best_rev = pick_latest_revision(rev_hist)
        incoming_rev = normalize_revision(_get_mark(best_rev) or f.get("revision") or "")

        matched_data = None
        if drawing_number and drawing_number in log_map:
            matched_data = log_map[drawing_number]
        elif drawing_title and drawing_title in title_map:
            matched_data = title_map[drawing_title]
            f["drawingNumber"] = matched_data["origNum"]

        if not matched_data:
            new_drawings.append({**ext, "_changeType": "new", "_previousRevision": "", "_latestRevEntry": best_rev})
        else:
            stored_rev = matched_data["rev"]
            cmp = compare_revisions(incoming_rev, stored_rev)
            if cmp > 0:
                revised_drawings.append({
                    **ext,
                    "_changeType": "revised",
                    "_previousRevision": stored_rev,
                    "_latestRevEntry": best_rev,
                })
            else:
                unchanged_drawings.append({
                    **ext,
                    "_changeType": "unchanged",
                    "_previousRevision": stored_rev,
                    "_latestRevEntry": best_rev,
                })

    return {
        "newDrawings":       new_drawings,
        "revisedDrawings":   revised_drawings,
        "unchangedDrawings": unchanged_drawings,
    }


# ── Internal helpers ──────────────────────────────────────

def _serialize_id(doc: dict) -> dict:
    """Stringify ObjectId fields in a MongoDB document."""
    for key in ("_id", "projectId", "createdByAdminId"):
        if doc.get(key):
            doc[key] = str(doc[key])
    return doc


def _build_transmittal_drawing(ext: dict, transmittal_number: int) -> dict:
    f = ext.get("extractedFields") or {}
    rev_hist = (f.get("revisionHistory") or []) if isinstance(f.get("revisionHistory"), list) else []
    if not rev_hist:
        rev_hist = [{"mark": f.get("revision"), "date": f.get("date"), "remarks": f.get("remarks")}]
    latest_rev = ext.get("_latestRevEntry") or pick_latest_revision(rev_hist)

    return {
        "extractionId": ext.get("_id"),
        "drawingNumber": f.get("drawingNumber") or "",
        "drawingTitle": f.get("drawingTitle") or f.get("drawingDescription") or ext.get("originalFileName") or "",
        "revision": _get_mark(latest_rev) or f.get("revision") or "",
        "date": latest_rev.get("date") or f.get("date") or "",
        "remarks": latest_rev.get("remarks") or f.get("remarks") or "",
        "folderName": ext.get("folderName") or "",
        "originalFileName": ext.get("originalFileName") or "",
        "changeType": ext.get("_changeType"),
        "previousRevision": ext.get("_previousRevision") or "",
    }


def _build_log_entry(ext: dict, transmittal_number: int, today: datetime) -> dict:
    f = ext.get("extractedFields") or {}
    rev_hist = (f.get("revisionHistory") or []) if isinstance(f.get("revisionHistory"), list) else []
    if not rev_hist:
        rev_hist = [{"mark": f.get("revision"), "date": f.get("date"), "remarks": f.get("remarks")}]
    latest_rev = ext.get("_latestRevEntry") or pick_latest_revision(rev_hist)

    normalized_history = [
        {
            "revision": normalize_revision(_get_mark(rh) or ""),
            "date": rh.get("date") or "",
            "transmittalNo": transmittal_number,
            "remarks": rh.get("remarks") or "",
            "recordedAt": today,
        }
        for rh in rev_hist
    ]

    return {
        "drawingNumber": (f.get("drawingNumber") or "").strip(),
        "drawingTitle": f.get("drawingTitle") or f.get("drawingDescription") or ext.get("originalFileName") or "",
        "description": f.get("description") or "",
        "folderName": ext.get("folderName") or "",
        "originalFileName": ext.get("originalFileName") or "",
        "currentRevision": normalize_revision(_get_mark(latest_rev) or f.get("revision") or ""),
        "revisionHistory": normalized_history,
        "firstTransmittalNo": transmittal_number,
        "lastUpdated": today,
    }


# ── Core Generation Function ──────────────────────────────

async def generate_transmittal(
    project_id: str,
    admin_id: str,
    target_extraction_ids: Optional[list] = None,
    target_transmittal_number: Optional[int] = None,
) -> dict:
    """
    Thread-safe entry point. Acquires project lock and delegates.
    Mirrors generateTransmittal() in transmittalService.js.
    """
    lock = _get_project_lock(project_id)
    async with lock:
        return await _internal_generate_transmittal(
            project_id, admin_id, target_extraction_ids, target_transmittal_number
        )


async def _internal_generate_transmittal(
    project_id: str,
    admin_id: str,
    target_extraction_ids: Optional[list],
    target_transmittal_number: Optional[int],
) -> dict:
    db = get_db()
    pid = ObjectId(project_id)

    # ── Step 1: Load relevant completed extractions ───────
    ext_filter: dict = {"projectId": pid, "status": "completed"}
    if target_extraction_ids:
        ext_filter["_id"] = {"$in": [ObjectId(eid) for eid in target_extraction_ids]}

    extractions = await db["drawing_extractions"].find(ext_filter).sort("createdAt", 1).to_list(None)

    if not extractions:
        raise ValueError("No completed extractions found for this transmittal.")

    # ── Step 2: Load existing Drawing Log ─────────────────
    drawing_log = await db["drawing_logs"].find_one({"projectId": pid})

    # ── Step 3: Determine transmittal number ──────────────
    append_to_existing = False
    transmittal_number: int

    if target_transmittal_number is not None:
        existing_tr = await db["transmittals"].find_one(
            {"projectId": pid, "transmittalNumber": target_transmittal_number}
        )
        if existing_tr:
            transmittal_number = target_transmittal_number
            append_to_existing = True
        else:
            transmittal_number = target_transmittal_number
            # Bump project counter if needed
            project = await db["projects"].find_one({"_id": pid})
            if not project:
                raise ValueError("Project not found.")
            if (project.get("transmittalCount") or 0) < transmittal_number:
                await db["projects"].update_one(
                    {"_id": pid},
                    {"$set": {"transmittalCount": transmittal_number}}
                )
    else:
        # Auto-increment
        updated_project = await db["projects"].find_one_and_update(
            {"_id": pid},
            {"$inc": {"transmittalCount": 1}},
            return_document=True,
        )
        if not updated_project:
            raise ValueError("Project not found.")
        transmittal_number = updated_project["transmittalCount"]

    # ── Step 4: Detect changes ────────────────────────────
    changes = detect_changes(extractions, drawing_log)
    new_drawings      = changes["newDrawings"]
    revised_drawings  = changes["revisedDrawings"]
    unchanged_drawings = changes["unchangedDrawings"]
    changed_drawings  = new_drawings + revised_drawings

    # ── Step 5: Early exit ────────────────────────────────
    if not changed_drawings:
        if not append_to_existing and target_transmittal_number is None:
            await db["projects"].update_one({"_id": pid}, {"$inc": {"transmittalCount": -1}})
        return {
            "transmittal": None,
            "drawingLog": _serialize_id(drawing_log) if drawing_log else None,
            "summary": {
                "newCount": 0,
                "revisedCount": 0,
                "unchangedCount": len(unchanged_drawings),
                "message": "No new or revised drawings detected. Transmittal not generated.",
            },
        }

    # ── Step 6: Build / Update Transmittal document ───────
    transmittal_drawings = [_build_transmittal_drawing(e, transmittal_number) for e in changed_drawings]

    combined_sequences: set = set()
    for ext in changed_drawings:
        for s in (ext.get("sequences") or []):
            combined_sequences.add(s)

    now = datetime.now(timezone.utc)

    if append_to_existing:
        new_tr = await db["transmittals"].find_one_and_update(
            {"projectId": pid, "transmittalNumber": transmittal_number},
            {
                "$push": {"drawings": {"$each": transmittal_drawings}},
                "$inc": {"newCount": len(new_drawings), "revisedCount": len(revised_drawings)},
                "$addToSet": {"sequences": {"$each": list(combined_sequences)}},
            },
            return_document=True,
        )
    else:
        tr_doc = {
            "projectId": pid,
            "createdByAdminId": ObjectId(admin_id),
            "transmittalNumber": transmittal_number,
            "drawings": transmittal_drawings,
            "newCount": len(new_drawings),
            "revisedCount": len(revised_drawings),
            "sequences": list(combined_sequences),
            "createdAt": now,
            "updatedAt": now,
        }
        result = await db["transmittals"].insert_one(tr_doc)
        new_tr = await db["transmittals"].find_one({"_id": result.inserted_id})

    # ── Step 7: Upsert Drawing Log ────────────────────────
    updated_log = await _upsert_drawing_log(
        db=db,
        project_id=pid,
        admin_id=admin_id,
        existing_log=drawing_log,
        new_drawings=new_drawings,
        revised_drawings=revised_drawings,
        transmittal_number=transmittal_number,
        today=now,
    )

    return {
        "transmittal": _serialize_id(dict(new_tr)),
        "drawingLog": _serialize_id(dict(updated_log)) if updated_log else None,
        "summary": {
            "newCount": len(new_drawings),
            "revisedCount": len(revised_drawings),
            "unchangedCount": len(unchanged_drawings),
            "transmittalNumber": transmittal_number,
        },
    }


async def _upsert_drawing_log(
    db, project_id, admin_id, existing_log, new_drawings, revised_drawings, transmittal_number, today
):
    pid = ObjectId(project_id) if isinstance(project_id, str) else project_id

    if not existing_log:
        # First transmittal: create Drawing Log from scratch
        all_entries = [
            _build_log_entry(ext, transmittal_number, today)
            for ext in new_drawings + revised_drawings
        ]
        log = await db["drawing_logs"].find_one_and_update(
            {"projectId": pid},
            {
                "$setOnInsert": {"projectId": pid, "createdByAdminId": ObjectId(admin_id)},
                "$set": {"lastTransmittalNo": transmittal_number},
                "$push": {"drawings": {"$each": all_entries}},
            },
            upsert=True,
            return_document=True,
        )
        return log

    # Subsequent transmittals: incremental bulk update
    bulk_ops = []

    for ext in new_drawings:
        entry = _build_log_entry(ext, transmittal_number, today)
        bulk_ops.append({
            "updateOne": {
                "filter": {"projectId": pid},
                "update": {"$push": {"drawings": entry}},
            }
        })

    for ext in revised_drawings:
        f = ext.get("extractedFields") or {}
        rev_hist = (f.get("revisionHistory") or []) if isinstance(f.get("revisionHistory"), list) else []
        if not rev_hist:
            rev_hist = [{"mark": f.get("revision"), "date": f.get("date"), "remarks": f.get("remarks")}]
        latest_rev = ext.get("_latestRevEntry") or pick_latest_revision(rev_hist)
        new_revision = normalize_revision(_get_mark(latest_rev) or f.get("revision") or "")

        d_num_key = (f.get("drawingNumber") or "").strip().upper()
        escaped = re.escape(d_num_key)

        hist_entry = {
            "revision": new_revision,
            "date": latest_rev.get("date") or f.get("date") or "",
            "transmittalNo": transmittal_number,
            "remarks": latest_rev.get("remarks") or f.get("remarks") or "",
            "recordedAt": today,
        }

        bulk_ops.append({
            "updateOne": {
                "filter": {"projectId": pid},
                "update": {
                    "$set": {
                        "drawings.$[elem].currentRevision": new_revision,
                        "drawings.$[elem].lastUpdated": today,
                    },
                    "$push": {"drawings.$[elem].revisionHistory": hist_entry},
                },
                "arrayFilters": [
                    {"elem.drawingNumber": {"$regex": f"^{escaped}$", "$options": "i"}}
                ],
            }
        })

    bulk_ops.append({
        "updateOne": {
            "filter": {"projectId": pid},
            "update": {"$set": {"lastTransmittalNo": transmittal_number, "updatedAt": today}},
        }
    })

    if bulk_ops:
        await db["drawing_logs"].bulk_write(bulk_ops)

    return await db["drawing_logs"].find_one({"projectId": pid})


# ── Accessor functions ────────────────────────────────────

async def get_transmittals(project_id: str) -> list:
    db = get_db()
    docs = await db["transmittals"].find(
        {"projectId": ObjectId(project_id)}
    ).sort("transmittalNumber", -1).to_list(None)
    return [_serialize_id(d) for d in docs]


async def get_drawing_log(project_id: str) -> Optional[dict]:
    db = get_db()
    doc = await db["drawing_logs"].find_one({"projectId": ObjectId(project_id)})
    return _serialize_id(dict(doc)) if doc else None
