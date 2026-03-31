/**
 * ============================================================
 * Admin Projects Controller
 * ============================================================
 * ALL operations scoped to req.principal.adminId.
 *
 * Routes:
 *   GET    /api/admin/projects                           — list own projects
 *   POST   /api/admin/projects                           — create project
 *   GET    /api/admin/projects/:projectId                — get one project
 *   PATCH  /api/admin/projects/:projectId                — update project
 *   DELETE /api/admin/projects/:projectId                — delete project
 *   POST   /api/admin/projects/:projectId/assignments    — assign user
 *   DELETE /api/admin/projects/:projectId/assignments/:userId — remove assignment
 *   POST   /api/admin/projects/:projectId/reserve-transmittal — reserve transmittal number
 */
const mongoose = require('mongoose');
const Project = require('../models/Project');
const Drawing = require('../models/Drawing');
const DrawingExtraction = require('../models/DrawingExtraction');
const RfiExtraction = require('../models/RfiExtraction');
const ChangeOrder = require('../models/ChangeOrder');
const { generateProjectStatusExcel } = require('../services/excelService');
const { attachProjectStats } = require('../services/projectStatsService');

/**
 * GET /api/admin/projects
 * List all projects owned by the logged-in admin.
 */
async function listProjects(req, res) {
    const adminId = req.principal.adminId;
    const { status, search } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (search) {
        filter.$or = [
            { name: { $regex: search, $options: 'i' } },
            { clientName: { $regex: search, $options: 'i' } },
        ];
    }

    const projects = await Project
        .find(filter)
        .sort({ createdAt: -1 });

    const projectsWithStats = await attachProjectStats(projects);
    res.json({ count: projectsWithStats.length, projects: projectsWithStats });
}

/**
 * POST /api/admin/projects
 * Creates project under this admin.
 * createdByAdminId is always injected server-side.
 */
async function createProject(req, res) {
    const adminId = req.principal.adminId;
    const { name, clientName, clientId, contactPerson, description, status, approximateDrawingsCount, location, sequences, connectionDesignVendor, connectionDesignContact } = req.body;

    if (!name || (!clientName && !clientId)) {
        return res.status(400).json({ error: 'name and either clientName or clientId are required.' });
    }

    const project = await Project.create({
        name,
        clientName: clientName || '',
        clientId: clientId || null,
        contactPerson: contactPerson || null,
        description: description || '',
        status: status || 'active',
        location: location || '',
        approximateDrawingsCount: Number(approximateDrawingsCount) || 0,
        sequences: sequences || [],
        connectionDesignVendor: connectionDesignVendor || '',
        connectionDesignContact: connectionDesignContact || '',
        createdByAdminId: adminId,
        assignments: [
            {
                userId: req.principal.id,
                username: req.principal.username,
                permission: 'admin',
                assignedAt: new Date(),
            }
        ],
        drawingCount: 0,
    });

    const projectObj = project.toObject({ virtuals: true });
    projectObj.id = project._id.toString();
    projectObj._id = project._id.toString();
    res.status(201).json({ project: projectObj });
}

/**
 * GET /api/admin/projects/:projectId
 * req.scopedProject is pre-loaded by scopeProjectToAdmin.
 */
async function getProject(req, res) {
    const projectWithStats = await attachProjectStats(req.scopedProject);
    res.json({ project: projectWithStats });
}

/**
 * PATCH /api/admin/projects/:projectId
 * Updates mutable fields. Cannot change createdByAdminId.
 */
async function updateProject(req, res) {
    const project = req.scopedProject;
    const { name, clientName, clientId, contactPerson, description, status, approximateDrawingsCount, location, sequences, connectionDesignVendor, connectionDesignContact } = req.body;

    if (name !== undefined) project.name = name;
    if (clientName !== undefined) project.clientName = clientName;
    if (clientId !== undefined) project.clientId = clientId;
    if (contactPerson !== undefined) project.contactPerson = contactPerson;
    if (description !== undefined) project.description = description;
    if (approximateDrawingsCount !== undefined) project.approximateDrawingsCount = Number(approximateDrawingsCount) || 0;
    if (location !== undefined) project.location = location;
    if (sequences !== undefined) project.sequences = sequences;
    if (connectionDesignVendor !== undefined) project.connectionDesignVendor = connectionDesignVendor;
    if (connectionDesignContact !== undefined) project.connectionDesignContact = connectionDesignContact;
    if (status !== undefined) {
        if (!['active', 'on_hold', 'completed', 'archived'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status value.' });
        }
        project.status = status;
    }

    await project.save();
    const projectObj = project.toObject({ virtuals: true });
    projectObj.id = project._id.toString();
    projectObj._id = project._id.toString();
    res.json({ project: projectObj });
}

/**
 * DELETE /api/admin/projects/:projectId
 * Deletes project and all its drawings/extractions.
 */
async function deleteProject(req, res) {
    const project = req.scopedProject;

    // 1. Delete all associated data
    await Drawing.deleteMany({ projectId: project._id });
    await DrawingExtraction.deleteMany({ projectId: project._id });

    // 2. Delete project itself
    await project.deleteOne();

    res.json({ message: `Project "${project.name}" and all related data deleted.` });
}

/**
 * POST /api/admin/projects/:projectId/assignments
 * Assigns a user to a project.
 *
 * SECURITY: validateCrossAdminAssignment middleware runs first,
 * ensuring req.assignmentUser.adminId === req.principal.adminId.
 *
 * Body: { userId, permission }
 */
async function assignUser(req, res) {
    const project = req.scopedProject;
    const user = req.assignmentUser;   // pre-validated by middleware
    const permission = req.body.permission || 'viewer';

    if (!['viewer', 'editor', 'admin'].includes(permission)) {
        return res.status(400).json({ error: 'permission must be viewer, editor, or admin.' });
    }

    // Check if user is already assigned → update permission instead
    const existingIdx = project.assignments.findIndex(
        (a) => a.userId.toString() === user._id.toString()
    );

    if (existingIdx >= 0) {
        project.assignments[existingIdx].permission = permission;
    } else {
        project.assignments.push({
            userId: user._id,
            username: user.username,
            permission,
            assignedAt: new Date(),
        });
    }

    await project.save();
    res.json({ project });
}

/**
 * DELETE /api/admin/projects/:projectId/assignments/:userId
 * Removes a user's assignment from a project.
 * Also validates the userId belongs to this admin.
 */
async function removeAssignment(req, res) {
    const project = req.scopedProject;
    const { userId } = req.params;
    const adminId = req.principal.adminId;

    // Safety check: confirm the userId belongs to this admin
    const User = require('../models/User');
    const user = await User.findOne({ _id: userId, adminId });
    if (!user) {
        return res.status(403).json({
            error: 'Cannot remove assignment: user not in your admin scope.',
        });
    }

    const before = project.assignments.length;
    project.assignments = project.assignments.filter(
        (a) => a.userId.toString() !== userId
    );

    if (project.assignments.length === before) {
        return res.status(404).json({ error: 'Assignment not found.' });
    }

    await project.save();
    res.json({ message: 'Assignment removed.', project });
}

/**
 * GET /api/admin/projects/status/excel
 * Downloads an Excel report with the status of all projects owned by this admin.
 * Columns: Project Name, Client Name, Total Drawings, Fabrication Count, Approval Count,
 *           Hold Count, Pending Count, Failed Count, Overall Status, Last Updated
 */
async function downloadAllProjectsStatusExcel(req, res) {
    // Fetch all projects
    const projects = await Project.find({}).sort({ createdAt: -1 }).lean();

    if (projects.length === 0) {
        return res.status(404).json({ error: 'No projects found.' });
    }

    const projectIds = projects.map(p => p._id);

    // Aggregate drawing counts per project, broken down by status and revision type
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

    // Build a fast lookup map
    const countMap = {};
    counts.forEach(c => {
        countMap[c._id.toString()] = c;
    });

    // ── Aggregate RFI Counts ──────────────────────────────────
    const rfiCounts = await RfiExtraction.aggregate([
        { $match: { createdByAdminId: new mongoose.Types.ObjectId(req.principal.adminId) } },
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

    // ── Aggregate Change Order Counts ──────────────────────────
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

    // Merge project data with aggregated stats
    const projectsData = projects.map(p => {
        const stats = countMap[p._id.toString()] || {};
        const rfiStats = rfiMap[p._id.toString()] || { openRfiCount: 0, closedRfiCount: 0 };
        const coStats = coMap[p._id.toString()] || { totalCO: 0, approvedCO: 0, workCompletedCO: 0, pendingCO: 0 };
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
        };
    });

    const { buffer, filename } = await generateProjectStatusExcel(projectsData);

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
}

/**
 * POST /api/admin/projects/:projectId/cor
 * Upload COR Excel file and parse into ChangeOrder model.
 */
async function uploadCOR(req, res) {
    const project = req.scopedProject;
    const adminId = req.principal.adminId;

    if (!req.file) {
        return res.status(400).json({ error: 'No Excel file uploaded.' });
    }

    try {
        const ExcelJS = require('exceljs');
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(req.file.path);

        const worksheet = workbook.getWorksheet(1); // Read first sheet
        if (!worksheet) {
            return res.status(400).json({ error: 'No worksheet found in Excel.' });
        }

        /**
         * EXPECTED COLUMNS in Excel:
         * A: CO Number
         * B: Description
         * C: Status (PENDING, APPROVED, WORK_COMPLETED, CANCELLED)
         * D: Amount
         * E: Date
         */
        let count = 0;
        const rows = [];
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return; // skip header

            const coNumber = row.getCell(1).text?.trim();
            const description = row.getCell(2).text?.trim();
            let statusRaw = row.getCell(3).text?.trim()?.toUpperCase();
            const amount = parseFloat(row.getCell(4).value) || 0;
            const dateVal = row.getCell(5).value;

            // Map some common variations to internal enum
            if (statusRaw === 'COMPLETED') statusRaw = 'WORK_COMPLETED';
            const VALID = ['PENDING', 'APPROVED', 'WORK_COMPLETED', 'CANCELLED'];
            const status = VALID.includes(statusRaw) ? statusRaw : 'PENDING';

            if (coNumber) {
                rows.push({
                    projectId: project._id,
                    createdByAdminId: adminId,
                    coNumber,
                    description: description || '',
                    status,
                    amount,
                    date: dateVal instanceof Date ? dateVal : new Date(),
                });
            }
        });

        if (rows.length === 0) {
            return res.status(400).json({ error: 'No valid rows found in Excel.' });
        }

        // Upsert all rows
        for (const r of rows) {
            await ChangeOrder.findOneAndUpdate(
                { projectId: r.projectId, coNumber: r.coNumber },
                r,
                { upsert: true, new: true }
            );
            count++;
        }

        // cleanup file
        const fs = require('fs');
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

        res.json({ message: `Success: ${count} change orders processed.` });
    } catch (error) {
        console.error('[uploadCOR] Error:', error);
        res.status(500).json({ error: 'Failed to process COR Excel.' });
    }
}

/**
 * POST /api/admin/projects/:projectId/reserve-transmittal
 */
async function reserveTransmittalNumber(req, res) {
    const project = req.scopedProject;
    const updated = await Project.findByIdAndUpdate(
        project._id,
        { $inc: { transmittalCount: 1 } },
        { new: true }
    ).lean();
    if (!updated) return res.status(404).json({ error: 'Project not found.' });
    res.json({ transmittalNumber: updated.transmittalCount });
}

module.exports = {
    listProjects,
    createProject,
    getProject,
    updateProject,
    deleteProject,
    assignUser,
    removeAssignment,
    downloadAllProjectsStatusExcel,
    uploadCOR,
    reserveTransmittalNumber,
};
