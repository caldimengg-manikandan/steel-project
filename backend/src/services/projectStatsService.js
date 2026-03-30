const mongoose = require('mongoose');
const DrawingExtraction = require('../models/DrawingExtraction');
const RfiExtraction = require('../models/RfiExtraction');
const ChangeOrder = require('../models/ChangeOrder');

/**
 * Calculates aggregated statistics for a list of projects.
 * @param {Array} projects - Array of project objects (Mongoose docs or POJOs).
 * @returns {Promise<Array>} - Projects array updated with stats.
 */
async function attachProjectStats(projects) {
    if (!projects || projects.length === 0) return [];
    
    // Normalize to array if single object passed
    const isSingle = !Array.isArray(projects);
    const projectsArray = isSingle ? [projects] : projects;
    
    const projectIds = projectsArray.map(p => p._id);

    // ── 1. Aggregate Drawing Stats ──────────────────────────
    const drawingCounts = await DrawingExtraction.aggregate([
        { $match: { projectId: { $in: projectIds } } },
        {
            $group: {
                _id: '$projectId',
                totalCount: { $sum: 1 },
                completedCount: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
                approvalCount: {
                    $sum: {
                        $cond: [
                            {
                                $and: [
                                    { $eq: ['$status', 'completed'] },
                                    {
                                        $or: [
                                            { $regexMatch: { input: { $ifNull: ["$extractedFields.revision", ""] }, regex: "^(rev\\s*)?[a-z]", options: "i" } },
                                            { $regexMatch: { input: { $ifNull: ["$extractedFields.remarks", ""] }, regex: "approved|approval", options: "i" } },
                                            { $regexMatch: { input: { $ifNull: ["$extractedFields.description", ""] }, regex: "approved|approval", options: "i" } }
                                        ]
                                    }
                                ]
                            },
                            1, 0
                        ]
                    }
                },
                fabricationCount: {
                    $sum: {
                        $cond: [
                            {
                                $and: [
                                    { $eq: ['$status', 'completed'] },
                                    { $regexMatch: { input: { $ifNull: ["$extractedFields.revision", ""] }, regex: "^(rev\\s*)?[0-9]", options: "i" } }
                                ]
                            },
                            1, 0
                        ]
                    }
                }
            }
        },
    ]);

    const drawingMap = {};
    drawingCounts.forEach((c) => {
        drawingMap[c._id.toString()] = {
            total: c.totalCount || 0,
            completed: c.completedCount || 0,
            approvalCount: c.approvalCount || 0,
            fabricationCount: c.fabricationCount || 0
        };
    });

    // ── 2. Aggregate RFI Stats ──────────────────────────────
    const rfiCounts = await RfiExtraction.aggregate([
        { $match: { projectId: { $in: projectIds } } },
        { $unwind: '$rfis' },
        {
            $group: {
                _id: '$projectId',
                openRfiCount: { $sum: { $cond: [{ $eq: ['$rfis.status', 'OPEN'] }, 1, 0] } },
                closedRfiCount: { $sum: { $cond: [{ $eq: ['$rfis.status', 'CLOSED'] }, 1, 0] } }
            }
        }
    ]);

    const rfiMap = {};
    rfiCounts.forEach(r => {
        rfiMap[r._id.toString()] = r;
    });

    // ── 3. Aggregate Change Order Stats ──────────────────────
    const coCounts = await ChangeOrder.aggregate([
        { $match: { projectId: { $in: projectIds } } },
        {
            $group: {
                _id: '$projectId',
                totalCO: { $sum: 1 },
                approvedCO: { $sum: { $cond: [{ $eq: ['$status', 'APPROVED'] }, 1, 0] } },
                workCompletedCO: { $sum: { $cond: [{ $eq: ['$status', 'WORK_COMPLETED'] }, 1, 0] } },
                pendingCO: { $sum: { $cond: [{ $eq: ['$status', 'PENDING'] }, 1, 0] } }
            }
        }
    ]);

    const coMap = {};
    coCounts.forEach(c => {
        coMap[c._id.toString()] = c;
    });

    // ── 4. Merge Stats with Projects ─────────────────────────
    const results = projectsArray.map((p) => {
        const pObj = typeof p.toObject === 'function' ? p.toObject({ virtuals: true }) : p;
        const stats = drawingMap[p._id.toString()] || { total: 0, completed: 0, approvalCount: 0, fabricationCount: 0 };
        const rfiStats = rfiMap[p._id.toString()] || { openRfiCount: 0, closedRfiCount: 0 };
        const coStats = coMap[p._id.toString()] || { totalCO: 0, approvedCO: 0, workCompletedCO: 0, pendingCO: 0 };
        const approx = pObj.approximateDrawingsCount || 0;
        
        let approvalPercentage = 0;
        let fabricationPercentage = 0;
        
        if (approx > 0) {
            approvalPercentage = Math.round((stats.approvalCount / approx) * 100);
            fabricationPercentage = Math.round((stats.fabricationCount / approx) * 100);
        }

        // Explicitly add id as a string so frontend always has a reliable ID field
        const idStr = pObj._id ? pObj._id.toString() : (pObj.id ? pObj.id.toString() : '');

        return {
            ...pObj,
            _id: idStr,
            id: idStr,
            drawingCount: stats.total,
            approvalCount: stats.approvalCount,
            fabricationCount: stats.fabricationCount,
            openRfiCount: rfiStats.openRfiCount,
            closedRfiCount: rfiStats.closedRfiCount,
            totalCO: coStats.totalCO,
            approvedCO: coStats.approvedCO,
            workCompletedCO: coStats.workCompletedCO,
            pendingCO: coStats.pendingCO,
            approvalPercentage,
            fabricationPercentage,
        };
    });

    return isSingle ? results[0] : results;
}

module.exports = { attachProjectStats };
