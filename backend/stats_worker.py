"""
============================================================
Stats Worker  (Python equivalent of services/projectStatsService.js)
============================================================
Calculates aggregated drawing, RFI, and change-order stats
for one or many projects by running MongoDB aggregation pipelines.

Called by project_service.py — equivalent to attachProjectStats().
============================================================
"""

import logging
from bson import ObjectId
from database import get_db

logger = logging.getLogger("stats_worker")


def _safe_str(val) -> str:
    """Convert ObjectId or any value to string safely."""
    return str(val) if val else ""


async def attach_project_stats(projects: list | dict) -> list | dict:
    """
    Attach live drawing / RFI / Change-Order stats to each project dict.
    Accepts a single project dict OR a list of project dicts.
    Mirrors attachProjectStats() from projectStatsService.js.
    """
    if not projects:
        return [] if isinstance(projects, list) else {}

    is_single = not isinstance(projects, list)
    projects_list = [projects] if is_single else projects

    if not projects_list:
        return [] if not is_single else {}

    db = get_db()

    # Build list of ObjectIds for aggregation $match
    project_ids = []
    for p in projects_list:
        raw_id = p.get("_id")
        try:
            project_ids.append(ObjectId(raw_id) if not isinstance(raw_id, ObjectId) else raw_id)
        except Exception:
            pass

    # ── 1. Drawing Stats Aggregation ─────────────────────────
    drawing_pipeline = [
        {"$match": {"projectId": {"$in": project_ids}}},
        {
            "$group": {
                "_id": "$projectId",
                "totalCount": {"$sum": 1},
                "completedCount": {"$sum": {"$cond": [{"$eq": ["$status", "completed"]}, 1, 0]}},
                "approvalCount": {
                    "$sum": {
                        "$cond": [
                            {
                                "$and": [
                                    {"$eq": ["$status", "completed"]},
                                    {
                                        "$or": [
                                            {"$regexMatch": {"input": {"$ifNull": ["$extractedFields.revision", ""]}, "regex": "^(rev\\s*)?[a-z]", "options": "i"}},
                                            {"$regexMatch": {"input": {"$ifNull": ["$extractedFields.remarks", ""]}, "regex": "approved|approval", "options": "i"}},
                                            {"$regexMatch": {"input": {"$ifNull": ["$extractedFields.description", ""]}, "regex": "approved|approval", "options": "i"}},
                                        ]
                                    },
                                ]
                            },
                            1,
                            0,
                        ]
                    }
                },
                "fabricationCount": {
                    "$sum": {
                        "$cond": [
                            {
                                "$and": [
                                    {"$eq": ["$status", "completed"]},
                                    {"$regexMatch": {"input": {"$ifNull": ["$extractedFields.revision", ""]}, "regex": "^(rev\\s*)?[0-9]", "options": "i"}},
                                ]
                            },
                            1,
                            0,
                        ]
                    }
                },
            }
        },
    ]

    drawing_results = await db["drawingextractions"].aggregate(drawing_pipeline).to_list(None)
    drawing_map = {
        str(r["_id"]): {
            "total": r.get("totalCount", 0),
            "completed": r.get("completedCount", 0),
            "approvalCount": r.get("approvalCount", 0),
            "fabricationCount": r.get("fabricationCount", 0),
        }
        for r in drawing_results
    }

    # ── 2. RFI Stats Aggregation ─────────────────────────────
    rfi_pipeline = [
        {"$match": {"projectId": {"$in": project_ids}}},
        {"$unwind": "$rfis"},
        {
            "$group": {
                "_id": "$projectId",
                "openRfiCount": {"$sum": {"$cond": [{"$eq": ["$rfis.status", "OPEN"]}, 1, 0]}},
                "closedRfiCount": {"$sum": {"$cond": [{"$eq": ["$rfis.status", "CLOSED"]}, 1, 0]}},
            }
        },
    ]

    rfi_results = await db["rfiextractions"].aggregate(rfi_pipeline).to_list(None)
    rfi_map = {
        str(r["_id"]): {
            "openRfiCount": r.get("openRfiCount", 0),
            "closedRfiCount": r.get("closedRfiCount", 0),
        }
        for r in rfi_results
    }

    # ── 3. Change-Order Stats Aggregation ────────────────────
    co_pipeline = [
        {"$match": {"projectId": {"$in": project_ids}}},
        {
            "$group": {
                "_id": "$projectId",
                "totalCO": {"$sum": 1},
                "approvedCO": {"$sum": {"$cond": [{"$eq": ["$status", "APPROVED"]}, 1, 0]}},
                "workCompletedCO": {"$sum": {"$cond": [{"$eq": ["$status", "WORK_COMPLETED"]}, 1, 0]}},
                "pendingCO": {"$sum": {"$cond": [{"$eq": ["$status", "PENDING"]}, 1, 0]}},
            }
        },
    ]

    co_results = await db["changeorders"].aggregate(co_pipeline).to_list(None)
    co_map = {
        str(r["_id"]): {
            "totalCO": r.get("totalCO", 0),
            "approvedCO": r.get("approvedCO", 0),
            "workCompletedCO": r.get("workCompletedCO", 0),
            "pendingCO": r.get("pendingCO", 0),
        }
        for r in co_results
    }

    # ── 4. Merge stats back into projects ────────────────────
    results = []
    for p in projects_list:
        pid = _safe_str(p.get("_id"))
        drw = drawing_map.get(pid, {"total": 0, "completed": 0, "approvalCount": 0, "fabricationCount": 0})
        rfi = rfi_map.get(pid, {"openRfiCount": 0, "closedRfiCount": 0})
        co = co_map.get(pid, {"totalCO": 0, "approvedCO": 0, "workCompletedCO": 0, "pendingCO": 0})

        try:
            approx = int(p.get("approximateDrawingsCount") or 0)
        except (ValueError, TypeError):
            approx = 0

        approval_pct = round((drw["approvalCount"] / approx) * 100) if approx > 0 else 0
        fabrication_pct = round((drw["fabricationCount"] / approx) * 100) if approx > 0 else 0

        enriched = {
            **p,
            "_id": pid,
            "id": pid,
            "drawingCount": drw["total"],
            "approvalCount": drw["approvalCount"],
            "fabricationCount": drw["fabricationCount"],
            "openRfiCount": rfi["openRfiCount"],
            "closedRfiCount": rfi["closedRfiCount"],
            "totalCO": co["totalCO"],
            "approvedCO": co["approvedCO"],
            "workCompletedCO": co["workCompletedCO"],
            "pendingCO": co["pendingCO"],
            "approvalPercentage": approval_pct,
            "fabricationPercentage": fabrication_pct,
        }
        results.append(enriched)

    return results[0] if is_single else results
