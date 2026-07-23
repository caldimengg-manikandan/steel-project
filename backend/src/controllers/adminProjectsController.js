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
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const Project = require('../models/Project');
const Drawing = require('../models/Drawing');
const DrawingExtraction = require('../models/DrawingExtraction');
const RfiExtraction = require('../models/RfiExtraction');
const ChangeOrder = require('../models/ChangeOrder');
const { generateProjectStatusExcel } = require('../services/excelService');
const { attachProjectStats } = require('../services/projectStatsService');
const { getExternalProjects } = require('../services/externalProjectService');
const storageGateway = require('../utils/storageGateway');
const { runExtractionPipeline } = require('../services/extractionService');

/**
 * GET /api/admin/projects
 * List all projects owned by the logged-in admin.
 */
async function listProjects(req, res) {
    const adminId = req.principal.adminId;
    const { status, search } = req.query;

    const filter = {};
    if (req.principal.role !== 'superadmin') {
        filter.createdByAdminId = adminId;
    }
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
    const { name, clientName, clientId, contactPerson, description, status, approximateDrawingsCount, location, sequences, connectionDesignVendor, connectionDesignContact, connectionDesignEmail, year, startingTransmittalNumber } = req.body;

    // ---- New validation: sequences is mandatory ----
    if (!Array.isArray(sequences) || sequences.length === 0) {
        return res.status(400).json({ error: 'The "sequences" field is required and must contain at least one entry.' });
    }

    if (!name || (!clientName && !clientId)) {
        return res.status(400).json({ error: 'name and either clientName or clientId are required.' });
    }

    const projectYear = year ? Number(year) : new Date().getFullYear();
    const startNum = (projectYear <= 2026 && startingTransmittalNumber) ? Number(startingTransmittalNumber) : 1;
    // Pre-seed transmittalCount so first reserve = startNum
    const initialTransmittalCount = startNum - 1;

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
        connectionDesignEmail: connectionDesignEmail || '',
        year: projectYear,
        startingTransmittalNumber: startNum,
        transmittalCount: initialTransmittalCount,
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

    res.status(201).json({ project });
}

/**
 * GET /api/admin/projects/:projectId
 * req.scopedProject is pre-loaded by scopeProjectToAdmin.
 */
async function getProject(req, res) {
    if (req.scopedProject && req.scopedProject.isExternal) {
        const p = req.scopedProject;
        const drawingCount = p.approximateDrawingsCount || 0;
        const approvalCount = Math.round(((p.approvalPercentage || 0) * drawingCount) / 100);
        const fabricationCount = Math.round(((p.fabricationPercentage || 0) * drawingCount) / 100);
        const projectWithStats = {
            ...p,
            _id: p.id,
            drawingCount,
            approvalCount,
            fabricationCount,
            openRfiCount: 0,
            closedRfiCount: 0,
            sequences: [],
            assignments: []
        };
        return res.json({ project: projectWithStats });
    }
    const projectWithStats = await attachProjectStats(req.scopedProject);
    res.json({ project: projectWithStats });
}

/**
 * PATCH /api/admin/projects/:projectId
 * Updates mutable fields. Cannot change createdByAdminId.
 */
async function updateProject(req, res) {
    const project = req.scopedProject;
    const { name, clientName, clientId, contactPerson, description, status, approximateDrawingsCount, location, sequences, connectionDesignVendor, connectionDesignContact, connectionDesignEmail } = req.body;

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
    if (connectionDesignEmail !== undefined) project.connectionDesignEmail = connectionDesignEmail;
    if (req.body.year !== undefined) project.year = Number(req.body.year);
    if (status !== undefined) {
        if (!['active', 'on_hold', 'completed', 'archived'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status value.' });
        }
        project.status = status;
    }

    await project.save();
    res.json({ project });
}

/**
 * DELETE /api/admin/projects/:projectId
 * Deletes project and all its drawings/extractions.
 * Also removes the project folder from the remote storage server.
 */
async function deleteProject(req, res) {
    const project = req.scopedProject;
    const projectName = project.name.replace(/[^a-zA-Z0-9 _-]/g, '_');

    // 1. Delete all files from the remote storage server (entire project folder)
    if (storageGateway.isEnabled()) {
        const projectFolder = `Projects/${projectName}`;
        try {
            await storageGateway.deleteFile(projectFolder);
            console.log(`[DeleteProject] Storage folder "${projectFolder}" deleted from server.`);
        } catch (err) {
            // If folder doesn't exist on storage, that's fine — continue with DB cleanup
            if (!err.message.includes('not found') && !err.message.includes('404')) {
                console.error(`[DeleteProject] Failed to delete storage folder "${projectFolder}":`, err.message);
            }
        }
    }

    // 2. Clean up local temp files for any DrawingExtraction records
    const extractions = await DrawingExtraction.find({ projectId: project._id }).lean();
    for (const doc of extractions) {
        if (doc.fileUrl && fs.existsSync(doc.fileUrl)) {
            try { fs.unlinkSync(doc.fileUrl); } catch (_) {}
        }
    }

    // 3. Delete all associated DB records
    await Drawing.deleteMany({ projectId: project._id });
    await DrawingExtraction.deleteMany({ projectId: project._id });
    await RfiExtraction.deleteMany({ projectId: project._id });
    await ChangeOrder.deleteMany({ projectId: project._id });

    // Clean up Transmittals if the model exists
    try {
        const Transmittal = require('../models/Transmittal');
        await Transmittal.deleteMany({ projectId: project._id });
    } catch (_) {}

    // Clean up DrawingLogs if the model exists
    try {
        const DrawingLog = require('../models/DrawingLog');
        await DrawingLog.deleteMany({ projectId: project._id });
    } catch (_) {}

    // 4. Delete project itself
    await project.deleteOne();

    res.json({ message: `Project "${project.name}" and all related data deleted from database and storage server.` });
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

    // Create Notification
    try {
        const Notification = require('../models/Notification');
        await Notification.create({
            user: user._id,
            title: 'New Project Assigned',
            body: `Project "${project.name}" has been assigned to you.`,
            type: 'assignment'
        });
    } catch (err) {
        console.error('Failed to create assignment notification:', err);
    }

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

    // Safety check: confirm the userId belongs to this admin (Removing global filter here because admin can manage any user)
    const User = require('../models/User');
    const user = await User.findOne({ _id: userId });
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
    const adminId = req.principal.adminId;

    const filter = {};
    if (req.principal.role !== 'superadmin') {
        filter.createdByAdminId = adminId;
    }
    const projects = await Project.find(filter).sort({ createdAt: -1 }).lean();

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

/**
 * GET /api/admin/projects/external
 * Retrieves projects and metadata from external App A.
 */
async function listExternalProjects(req, res) {
    const result = await getExternalProjects();
    res.json(result);
}

/**
 * POST /api/admin/projects/:projectId/upload-folder
 *
 * Accepts: multipart/form-data with:
 *   - files[]         — the files with webkitRelativePath preserved as relative path in the folder
 *   - paths[]         — matching array of relative paths (same index as files)
 *   - sequences[]     — (optional) sequence tags
 *   - transmittalNumber — (optional) a pre-reserved transmittal number
 *
 * Behaviour:
 *   1. Uploads ALL files to storage gateway preserving directory structure:
 *      Projects/<projectName>/<topFolder>/<relativePath>
 *   2. Detects drawing PDFs inside the "Drawings/Detail sheets" and "Drawings/E-Sheets" folders
 *      (case-insensitive, backslash or forward-slash separator)
 *   3. Saves a temp local copy of each drawing PDF for the AI service to read
 *   4. Creates DrawingExtraction records and fires the extraction pipeline
 */
async function uploadFolder(req, res) {
    const project = req.scopedProject;
    const adminId = req.principal.adminId;
    const uploadedBy = req.principal.username;
    const projectId = project._id.toString();

    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded.' });
    }

    const pathArray = Array.isArray(req.body.paths) ? req.body.paths : (req.body.paths ? [req.body.paths] : []);
    const targetTransmittalNumber = req.body.transmittalNumber ? parseInt(req.body.transmittalNumber, 10) : null;
    let sequences = [];
    if (req.body.sequences) {
        sequences = Array.isArray(req.body.sequences) ? req.body.sequences : [req.body.sequences];
    }

    const projectName = project.name.replace(/[^a-zA-Z0-9 _-]/g, '_');

    // Patterns that indicate a drawing PDF worth extracting
    const DRAWING_FOLDER_PATTERN = /[\\/](detail[\s_-]*sheets?|d[\s_-]*sheets?|e[\s_-]*sheets?|erection[\s_-]*sheets?|gather[\s_-]*sheets?|g[\s_-]*sheets?|shop[\s_-]*drawings?|connection[\s_-]*drawings?|fabrication[\s_-]*drawings?)[\s\\/]/i;
    const BINDER_PATTERN = /[\/ ](binders?|binder[_\s-]?sheet)[\/ ]/i;

    // ── Step 1: Upload all files to storage gateway ───────
    const uploadResults = [];
    const drawingFiles = []; // subset that are drawing PDFs

    for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const relativePath = pathArray[i] || file.originalname;

        // Get the optional base target path (from Storage UI), otherwise default to root project folder
        const baseTarget = req.body.targetPath || `Projects/${projectName}`;
        
        // Determine storage path, preserving the relative upload structure
        const targetDir = `${baseTarget}/${path.dirname(relativePath).replace(/\\/g, '/')}`;
        const cleanTargetDir = targetDir.replace(/\/+/g, '/').replace(/\/$/, '').replace(/\/\.$/, '');

        let storageGatewayPath = null;
        let uploadedToGateway = false;

        if (storageGateway.isEnabled()) {
            let lastError = null;
            const maxRetries = 5;
            const baseDelay = 1000; // 1 second base delay

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    const fileBuffer = fs.readFileSync(file.path);
                    await storageGateway.uploadFile(cleanTargetDir, file.originalname, fileBuffer);
                    storageGatewayPath = `${cleanTargetDir}/${file.originalname}`;
                    console.log(`[FolderUpload] Stored: ${storageGatewayPath} (Attempt ${attempt})`);
                    uploadedToGateway = true;
                    break;
                } catch (err) {
                    lastError = err;
                    const isRateLimit = err.message.includes('Too many requests') || err.message.includes('429');
                    const waitTime = isRateLimit ? baseDelay * attempt * 2 : baseDelay * attempt;
                    
                    console.warn(`[FolderUpload] Attempt ${attempt} failed for ${file.originalname}. Error: ${err.message}. Retrying in ${waitTime}ms...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                }
            }

            if (!uploadedToGateway) {
                console.error(`[FolderUpload] Failed to store ${relativePath} to Storage Gateway after ${maxRetries} attempts:`, lastError?.message);
                uploadResults.push({ name: file.originalname, path: relativePath, status: 'failed_gateway', error: lastError?.message || 'Gateway Upload failed' });
                console.warn(`[FolderUpload] Continuing without Storage Gateway sync for ${file.originalname}. Falling back to GridFS/Local.`);
            }
        }

        // 3. Fallback to GridFS if Storage Gateway is not enabled or if it failed
        if (!uploadedToGateway) {
            try {
                const gridfs = require('../utils/gridfs');
                const bucket = gridfs.getBucket();
                if (bucket) {
                    const uploadStream = bucket.openUploadStream(file.originalname, {
                        contentType: file.mimetype,
                        metadata: { originalName: file.originalname, path: cleanTargetDir }
                    });
                    fs.createReadStream(file.path).pipe(uploadStream);
                    await new Promise((resolve, reject) => {
                        uploadStream.on('finish', resolve);
                        uploadStream.on('error', reject);
                    });
                    console.log(`[FolderUpload] Uploaded to GridFS as fallback: ${file.originalname}`);
                }
            } catch (err) {
                console.error('[FolderUpload] Failed to upload to GridFS:', err.message);
            }
        }

        uploadResults.push({ name: file.originalname, path: relativePath, status: 'stored' });

        // ── Step 2: Check if this file is a drawing PDF ───
        const isPdf = file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
        const isDrawingFolder = DRAWING_FOLDER_PATTERN.test('/' + relativePath.replace(/\\/g, '/') + '/');
        const isBinderFolder = BINDER_PATTERN.test('/' + relativePath.replace(/\\/g, '/') + '/');

        if (isPdf && isDrawingFolder && !isBinderFolder) {
            // Determine folderName (the parent folder like "Detail sheets" or "E-Sheets")
            const parts = relativePath.replace(/\\/g, '/').split('/');
            let folderName = parts.length >= 2 ? parts[parts.length - 2] : 'DRAWINGS';

            drawingFiles.push({
                file,
                relativePath,
                folderName,
                storageGatewayPath,
            });
        } else {
            // Not a drawing PDF, clean up from local disk since it was successfully uploaded to gateway
            try { fs.unlinkSync(file.path); } catch (_) {}
        }
    }

    // ── Step 3: Create extraction docs using the existing local disk paths ──
    const extractionDocs = [];

    for (const { file, relativePath, folderName, storageGatewayPath } of drawingFiles) {
        extractionDocs.push({
            projectId,
            createdByAdminId: adminId,
            originalFileName: file.originalname,
            fileUrl: file.path, // Use the disk file path directly
            storageGatewayPath: storageGatewayPath || '',
            folderName,
            fileSize: file.size,
            uploadedBy,
            targetTransmittalNumber,
            sequences,
            status: 'queued',
        });
    }

    let savedDocs = [];
    if (extractionDocs.length > 0) {
        // Pre-cleanup: remove any existing extractions with the same filename in this project
        const fileNames = extractionDocs.map(e => e.originalFileName);
        await DrawingExtraction.deleteMany({
            projectId: new mongoose.Types.ObjectId(projectId),
            originalFileName: { $in: fileNames.map(f => new RegExp(`^${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')) },
        });

        savedDocs = await DrawingExtraction.insertMany(extractionDocs);

        // Fire extraction pipeline for each drawing
        for (const doc of savedDocs) {
            runExtractionPipeline(
                doc._id.toString(),
                doc.fileUrl,
                projectId,
                targetTransmittalNumber
            ).catch(err => console.error(`[FolderUpload] Pipeline error for ${doc.originalFileName}:`, err.message));
        }
    }

    const storedCount = uploadResults.filter(r => r.status === 'stored').length;
    const failedCount = uploadResults.filter(r => r.status === 'failed').length;

    res.status(202).json({
        message: `${storedCount} file(s) stored on server. ${savedDocs.length} drawing(s) queued for extraction.${failedCount > 0 ? ` (${failedCount} files failed to store)` : ''}`,
        storedCount,
        drawingsQueued: savedDocs.length,
        extractionIds: savedDocs.map(d => d._id),
        transmittalNumber: targetTransmittalNumber,
        failedCount,
        results: uploadResults,
        drawings: savedDocs.map(d => ({ name: d.originalFileName, folder: d.folderName, id: d._id.toString() })),
    });
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
    listExternalProjects,
    uploadFolder,
};
