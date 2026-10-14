const mongoose = require('mongoose');
const Project = require('../models/Project');
const DrawingExtraction = require('../models/DrawingExtraction');
const RfiExtraction = require('../models/RfiExtraction');
const ChangeOrder = require('../models/ChangeOrder');
const { getExternalProjects } = require('./externalProjectService');
const { calculateSowProgress } = require('../utils/sowCalculator');

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
                                            { $eq: ['$uploadPurpose', 'Approval'] },
                                            {
                                                $and: [
                                                    { $or: [{ $eq: ['$uploadPurpose', ''] }, { $eq: ['$uploadPurpose', null] }] },
                                                    {
                                                        $or: [
                                                            { $regexMatch: { input: { $ifNull: ["$extractedFields.revision", ""] }, regex: "^(rev\\s*)?[a-z]", options: "i" } },
                                                            { $regexMatch: { input: { $ifNull: ["$extractedFields.remarks", ""] }, regex: "approved|approval", options: "i" } },
                                                            { $regexMatch: { input: { $ifNull: ["$extractedFields.description", ""] }, regex: "approved|approval", options: "i" } }
                                                        ]
                                                    }
                                                ]
                                            }
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
                                    {
                                        $or: [
                                            { $eq: ['$uploadPurpose', 'Fabrication'] },
                                            {
                                                $and: [
                                                    { $or: [{ $eq: ['$uploadPurpose', ''] }, { $eq: ['$uploadPurpose', null] }] },
                                                    { $regexMatch: { input: { $ifNull: ["$extractedFields.revision", ""] }, regex: "^(rev\\s*)?[0-9]", options: "i" } }
                                                ]
                                            }
                                        ]
                                    }
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
                totalAmount: { $sum: '$amount' },
                approvedCO: { $sum: { $cond: [{ $eq: ['$status', 'APPROVED'] }, 1, 0] } },
                approvedAmount: { $sum: { $cond: [{ $eq: ['$status', 'APPROVED'] }, '$amount', 0] } },
                workCompletedCO: { $sum: { $cond: [{ $eq: ['$status', 'WORK_COMPLETED'] }, 1, 0] } },
                workCompletedAmount: { $sum: { $cond: [{ $eq: ['$status', 'WORK_COMPLETED'] }, '$amount', 0] } },
                pendingCO: { $sum: { $cond: [{ $eq: ['$status', 'PENDING'] }, 1, 0] } },
                pendingAmount: { $sum: { $cond: [{ $eq: ['$status', 'PENDING'] }, '$amount', 0] } }
            }
        }
    ]);

    const coMap = {};
    coCounts.forEach(c => {
        coMap[c._id.toString()] = c;
    });

    // Fetch external projects to see if any match the local projects by name
    let externalProjects = [];
    try {
        const extResult = await getExternalProjects();
        if (extResult && Array.isArray(extResult.projects)) {
            externalProjects = extResult.projects;
        }
    } catch (err) {
        console.warn('[projectStatsService] Failed to load external projects:', err.message);
    }

    // Resolve missing creator login names from Admin and User models if needed
    const missingAdminIds = projectsArray
        .filter(p => {
            const pObj = typeof p.toObject === 'function' ? p.toObject() : p;
            return !pObj.createdByUsername && !(pObj.assignments || []).some(a => a.permission === 'admin' && a.username);
        })
        .map(p => p.createdByAdminId)
        .filter(Boolean);

    let adminUserMap = {};
    if (missingAdminIds.length > 0) {
        try {
            const Admin = require('../models/Admin');
            const User = require('../models/User');
            const [admins, users] = await Promise.all([
                Admin.find({ _id: { $in: missingAdminIds } }).select('username displayName').lean(),
                User.find({ _id: { $in: missingAdminIds } }).select('username displayName').lean(),
            ]);
            admins.forEach(a => { adminUserMap[a._id.toString()] = a.username || a.displayName; });
            users.forEach(u => { adminUserMap[u._id.toString()] = u.username || u.displayName; });
        } catch (mapErr) {
            console.warn('[projectStatsService] Error resolving creator admin/user:', mapErr.message);
        }
    }

    // ── 4. Merge Stats with Projects ─────────────────────────
    const results = projectsArray.map((p) => {
        const pObj = typeof p.toObject === 'function' ? p.toObject() : p;
        const stats = drawingMap[p._id.toString()] || { total: 0, completed: 0, approvalCount: 0, fabricationCount: 0 };
        const rfiStats = rfiMap[p._id.toString()] || { openRfiCount: 0, closedRfiCount: 0 };
        const coStats = coMap[p._id.toString()] || { 
            totalCO: 0, 
            totalAmount: 0,
            approvedCO: 0, 
            approvedAmount: 0,
            workCompletedCO: 0, 
            workCompletedAmount: 0,
            pendingCO: 0,
            pendingAmount: 0 
        };
        const approx = pObj.approximateDrawingsCount || 0;
        const allSows = pObj.scopeOfWork || [];
        const sowProgress = calculateSowProgress(allSows);

        const nameLower = (pObj.name || '').toLowerCase().trim();
        const matchingExt = externalProjects.find(ext => (ext.name || '').toLowerCase().trim() === nameLower);

        let mergedCorStatus = {
            hasCOR: true,
            totalCORItems: coStats.totalCO || 0,
            totalAmount: coStats.totalAmount || 0,
            statusSummary: {
                Approved: coStats.approvedCO || 0,
                Completed: coStats.workCompletedCO || 0,
                Submitted: coStats.pendingCO || 0,
            },
            statusAmounts: {
                Approved: coStats.approvedAmount || 0,
                Completed: coStats.workCompletedAmount || 0,
                Submitted: coStats.pendingAmount || 0,
            }
        };

        let mergedApproximateDrawingsCount = approx;
        if (matchingExt) {
            if (matchingExt.corStatus) {
                mergedCorStatus = matchingExt.corStatus;
            }
            if (stats.total === 0) {
                mergedApproximateDrawingsCount = matchingExt.approximateDrawingsCount || approx;
            }
        }

        let creatorName = pObj.createdByUsername || '';
        if (!creatorName) {
            const adminAssignment = (pObj.assignments || []).find(a => a.permission === 'admin') || (pObj.assignments || [])[0];
            if (adminAssignment && adminAssignment.username) {
                creatorName = adminAssignment.username;
            } else if (pObj.createdByAdminId && adminUserMap[pObj.createdByAdminId.toString()]) {
                creatorName = adminUserMap[pObj.createdByAdminId.toString()];
            } else if (matchingExt && (matchingExt.projectManager || matchingExt.createdBy)) {
                creatorName = matchingExt.projectManager || matchingExt.createdBy;
            }
        }

        return {
            ...pObj,
            createdByUsername: creatorName,
            createdBy: creatorName,
            drawingCount: stats.total,
            approvalCount: stats.approvalCount,
            fabricationCount: stats.fabricationCount,
            openRfiCount: rfiStats.openRfiCount,
            closedRfiCount: rfiStats.closedRfiCount,
            totalCO: coStats.totalCO,
            approvedCO: coStats.approvedCO,
            workCompletedCO: coStats.workCompletedCO,
            pendingCO: coStats.pendingCO,
            totalAmount: coStats.totalAmount,
            approvedAmount: coStats.approvedAmount,
            workCompletedAmount: coStats.workCompletedAmount,
            pendingAmount: coStats.pendingAmount,
            approximateDrawingsCount: mergedApproximateDrawingsCount,
            approvalPercentage: sowProgress.approvalPercentage,
            fabricationPercentage: sowProgress.fabricationPercentage,
            sowContributions: sowProgress.sowContributions,
            corStatus: mergedCorStatus,
            rawStatus: matchingExt?.rawStatus,
            updatedAtFromAppA: matchingExt?.updatedAt || null
        };
    });

    return isSingle ? results[0] : results;
}

/**
 * Fetches projects and compiles aggregated status data identically for both
 * the Project Status module download and the automated weekly report email.
 *
 * @param {object} filter - MongoDB query filter for Project model (default: {})
 * @returns {Promise<Array<object>>} - Projects data array ready for generateProjectStatusExcel
 */
async function getProjectStatusReportData(filter = {}) {
    const projects = await Project.find(filter).sort({ createdAt: -1 }).lean();
    if (!projects || projects.length === 0) {
        return [];
    }

    const projectIds = projects.map(p => p._id);

    // 1. Aggregate drawing counts per project
    const counts = await DrawingExtraction.aggregate([
        { $match: { projectId: { $in: projectIds } } },
        {
            $group: {
                _id: '$projectId',
                totalDrawings: { $sum: 1 },
                approvalCount: {
                    $sum: {
                        $cond: [
                            {
                                $or: [
                                    {
                                        $regexMatch: {
                                            input: { $ifNull: ['$extractedFields.revision', ''] },
                                            regex: '^(rev\\s*)?[a-z]',
                                            options: 'i'
                                        }
                                    },
                                    {
                                        $regexMatch: {
                                            input: { $ifNull: ['$extractedFields.remarks', ''] },
                                            regex: 'approved|approval',
                                            options: 'i'
                                        }
                                    },
                                    {
                                        $regexMatch: {
                                            input: { $ifNull: ['$extractedFields.description', ''] },
                                            regex: 'approved|approval',
                                            options: 'i'
                                        }
                                    }
                                ]
                            }, 1, 0
                        ]
                    }
                },
                fabricationCount: {
                    $sum: {
                        $cond: [
                            {
                                $regexMatch: {
                                    input: { $ifNull: ['$extractedFields.revision', ''] },
                                    regex: '^(rev\\s*)?[0-9]',
                                    options: 'i'
                                }
                            }, 1, 0
                        ]
                    }
                },
                holdCount: {
                    $sum: { $cond: [{ $eq: ['$status', 'on_hold'] }, 1, 0] }
                },
                pendingCount: {
                    $sum: { $cond: [{ $in: ['$status', ['queued', 'processing']] }, 1, 0] }
                },
                failedCount: {
                    $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] }
                },
            }
        },
    ]);

    const countMap = {};
    counts.forEach(c => {
        countMap[c._id.toString()] = c;
    });

    // 2. Aggregate RFI Counts per project
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

    // 3. Aggregate Change Order Counts per project
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

    // 4. Fetch external projects from App A
    let externalProjects = [];
    try {
        const extResult = await getExternalProjects();
        if (extResult && Array.isArray(extResult.projects)) {
            externalProjects = extResult.projects;
        }
    } catch (err) {
        console.warn('[projectStatsService] Failed to load external projects for status report:', err.message);
    }

    // 5. Merge project data with aggregated stats
    const projectsData = projects.map(p => {
        const stats = countMap[p._id.toString()] || {};
        const rfiStats = rfiMap[p._id.toString()] || { openRfiCount: 0, closedRfiCount: 0 };
        const coStats = coMap[p._id.toString()] || { totalCO: 0, approvedCO: 0, workCompletedCO: 0, pendingCO: 0 };
        const allSows = p.scopeOfWork || [];
        const sowProg = calculateSowProgress(allSows);

        const appPct = sowProg.approvalPercentage;
        const fabPct = sowProg.fabricationPercentage;

        const matchingExt = externalProjects.find(ep => 
            (ep.name || '').trim().toLowerCase() === (p.name || '').trim().toLowerCase()
        );

        return {
            ...p,
            totalDrawings: stats.totalDrawings || 0,
            fabricationCount: stats.fabricationCount || 0,
            approvalCount: stats.approvalCount || 0,
            holdCount: stats.holdCount || 0,
            pendingCount: stats.pendingCount || 0,
            failedCount: stats.failedCount || 0,
            openRfiCount: rfiStats.openRfiCount,
            closedRfiCount: rfiStats.closedRfiCount,
            totalCO: coStats.totalCO,
            approvedCO: coStats.approvedCO,
            workCompletedCO: coStats.workCompletedCO,
            pendingCO: coStats.pendingCO,
            corStatus: matchingExt ? matchingExt.corStatus : null,
            fabricationPercentage: fabPct,
            approvalPercentage: appPct,
            rawStatus: matchingExt ? matchingExt.rawStatus : '',
            // Data from external project management app
            financialYear: matchingExt ? matchingExt.financialYear : '',
            projectCode: matchingExt ? matchingExt.projectCode : '',
            division: matchingExt ? matchingExt.division : '',
            projectManager: matchingExt ? matchingExt.projectManager : '',
            clientName: matchingExt ? matchingExt.clientName : p.clientName,
            name: matchingExt ? matchingExt.name : p.name,
            location: matchingExt?.location || p.location || '',
        };
    });

    return projectsData;
}

module.exports = { attachProjectStats, getProjectStatusReportData };

