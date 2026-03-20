/**
 * ============================================================
 * Drawing Extraction Controller
 * ============================================================
 * Handles:
 *  POST   /api/extractions/:projectId/upload    — Upload PDF + start extraction
 *  GET    /api/extractions/:projectId           — List all extractions for project
 *  GET    /api/extractions/:projectId/:id       — Get single extraction
 *  POST   /api/extractions/:projectId/:id/reprocess — Re-run failed extraction
 *  GET    /api/extractions/:projectId/excel/download — Download Excel file
 *  DELETE /api/extractions/:projectId/:id       — Delete extraction (admin only)
 *
 * Security: all routes enforce admin-scope via middleware,
 * so req.principal.adminId is always the logged-in tenant.
 */
const path = require('path');
const fs = require('fs');
const DrawingExtraction = require('../models/DrawingExtraction');
const Project = require('../models/Project');
const { runExtractionPipeline } = require('../services/extractionService');
const { getProjectExcelPath, generateProjectExcel } = require('../services/excelService');

// ── Upload + Start Extraction ─────────────────────────────
exports.uploadAndExtract = async (req, res) => {
    const { projectId } = req.params;
    const adminId = req.principal.adminId;
    const uploadedBy = req.principal.username;

    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No PDF files uploaded.' });
    }

    const paths = req.body.paths || [];
    const localSavePath = req.body.localSavePath || '';
    const pathArray = Array.isArray(paths) ? paths : [paths];
    // null → auto-assign next transmittal number; integer → append to that existing transmittal
    const rawTN = req.body.targetTransmittalNumber;
    let targetTransmittalNumber = rawTN != null && rawTN !== '' ? parseInt(rawTN, 10) : null;

    if (targetTransmittalNumber === null) {
        // Pre-reserve a new transmittal number for this batch upload
        // This ensures all drawings in this upload batch go into ONE new transmittal
        const updatedProject = await Project.findByIdAndUpdate(
            projectId,
            { $inc: { transmittalCount: 1 } },
            { new: true }
        ).lean();
        if (updatedProject) {
            targetTransmittalNumber = updatedProject.transmittalCount;
        }
    }

    // Filter and determine folder name
    const validFiles = [];
    req.files.forEach((file, i) => {
        const fullPath = pathArray[i] || file.originalname;
        const lowerPath = fullPath.toLowerCase();

        let folderName = '';
        if (fullPath.includes('/')) {
            const parts = fullPath.split('/');
            if (parts.length > 1) {
                folderName = parts[parts.length - 2];
            }
        } else if (fullPath.includes('\\')) {
            const parts = fullPath.split('\\');
            if (parts.length > 1) {
                folderName = parts[parts.length - 2];
            }
        }

        if (!folderName) {
            folderName = 'DRAWINGS'; // Default if none
        }

        // ── Skip files from any binder-named folder ───────────
        // Matches: Binder, binder, BINDER, binders, BINDERS,
        //          BINDER SHEET, Binder sheet, BINDER_SHEET, etc.
        const BINDER_PATTERN = /\bbinder(s|[\s_\-]?sheet)?\b/i;
        if (BINDER_PATTERN.test(folderName)) {
            console.log(`[Upload] Skipping file in binder folder: "${folderName}" — ${file.originalname}`);
            return; // skip this file
        }

        validFiles.push({ file, folderName });
    });

    if (validFiles.length === 0) {
        return res.status(400).json({ error: 'No actionable PDF files found.' });
    }

    const extractionDocs = validFiles.map(({ file, folderName }) => ({
        projectId,
        createdByAdminId: adminId,
        originalFileName: file.originalname,
        folderName,
        fileUrl: file.path,
        fileSize: file.size,
        uploadedBy,
        localSavePath,
        targetTransmittalNumber,
        status: 'queued',
    }));

    // Batch insert for performance
    const savedDocs = await DrawingExtraction.insertMany(extractionDocs);

    // Trigger background extraction for each
    for (const doc of savedDocs) {
        runExtractionPipeline(
            doc._id.toString(),
            doc.fileUrl,
            projectId,
            targetTransmittalNumber
        ).catch((err) => {
            console.error(`[Upload] Pipeline error for ${doc.originalFileName}:`, err.message);
        });
    }

    res.status(202).json({
        message: `${req.files.length} file(s) uploaded. Extraction started.`,
        extractionIds: savedDocs.map(d => d._id),
        status: 'queued',
    });
};

// ── Pre-flight Duplicate Check ────────────────────────────
/**
 * POST /api/extractions/:projectId/check-duplicates
 * Body: { filenames: string[], sheetNumbers?: string[], revisions?: string[] }
 *
 * Compares the incoming file list against completed extractions in MongoDB.
 * Returns a list of duplicate drawings (same sheet number + same revision).
 * The frontend uses this to show a confirmation popup before uploading.
 */
exports.checkDuplicates = async (req, res) => {
    const { projectId } = req.params;
    const adminId = req.principal.adminId;
    const { filenames = [] } = req.body;

    if (!Array.isArray(filenames) || filenames.length === 0) {
        return res.status(400).json({ error: 'filenames array is required.' });
    }

    // Pull all completed extractions for this project
    const existing = await DrawingExtraction.find({
        projectId,
        createdByAdminId: adminId,
        status: 'completed',
    }).select('originalFileName extractedFields').lean();

    // Build lookup maps: filename -> record, drawingNumber -> record
    const byFilename = {};
    const byDrawingNumber = {};
    existing.forEach(e => {
        byFilename[e.originalFileName] = e;
        const dn = e.extractedFields && e.extractedFields.drawingNumber;
        if (dn) byDrawingNumber[dn] = e;
    });

    // Detect duplicates: same filename means same drawing (revision comparison done via filename)
    const duplicates = [];
    filenames.forEach(fname => {
        const existing = byFilename[fname];
        if (existing) {
            duplicates.push({
                filename: fname,
                sheetNumber: (existing.extractedFields && existing.extractedFields.drawingNumber) || '',
                revision: (existing.extractedFields && existing.extractedFields.revision) || '',
            });
        }
    });

    res.json({
        hasDuplicates: duplicates.length > 0,
        duplicateCount: duplicates.length,
        duplicates,
    });
};

// ── List Extractions for a Project ───────────────────────
exports.listExtractions = async (req, res) => {
    const { projectId } = req.params;
    const adminId = req.principal.adminId;

    const extractions = await DrawingExtraction.find({
        projectId,
        createdByAdminId: adminId,          // ← tenant isolation
    })
        .sort({ createdAt: -1 })
        .lean();

    // Check if Excel file exists for this project
    const excelPath = getProjectExcelPath(projectId);
    const hasExcel = Boolean(excelPath);
    const excelDownUrl = hasExcel
        ? `/api/extractions/${projectId}/excel/download`
        : null;

    res.json({ extractions, hasExcel, excelDownloadUrl: excelDownUrl });
};

// ── Get Single Extraction ────────────────────────────────
exports.getExtraction = async (req, res) => {
    const { projectId, id } = req.params;
    const adminId = req.principal.adminId;

    const doc = await DrawingExtraction.findOne({
        _id: id,
        projectId,
        createdByAdminId: adminId,         // ← tenant isolation
    }).lean();

    if (!doc) {
        return res.status(404).json({ error: 'Extraction not found.' });
    }

    res.json(doc);
};

// ── Reprocess Failed Extraction ──────────────────────────
exports.reprocess = async (req, res) => {
    const { projectId, id } = req.params;
    const adminId = req.principal.adminId;

    const doc = await DrawingExtraction.findOne({
        _id: id,
        projectId,
        createdByAdminId: adminId,
    });

    if (!doc) {
        return res.status(404).json({ error: 'Extraction not found.' });
    }

    if (!fs.existsSync(doc.fileUrl)) {
        return res.status(400).json({ error: 'Original file no longer exists on disk. Please re-upload.' });
    }

    // Reset status and clear old data
    await DrawingExtraction.findByIdAndUpdate(id, {
        status: 'queued',
        errorMessage: '',
        extractedFields: null,
        extractionConfidence: 0,
    });

    res.json({ message: 'Reprocessing started.', status: 'queued' });

    // Fire-and-forget
    runExtractionPipeline(id, doc.fileUrl, projectId).catch((err) => {
        console.error('[Reprocess] Pipeline error:', err.message);
    });
};

// ── Download Excel ────────────────────────────────────────
exports.downloadExcel = async (req, res) => {
    const { projectId } = req.params;
    const adminId = req.principal.adminId;

    // Fetch all completed extractions for this project (fresh, live data)
    const extractions = await DrawingExtraction.find({
        projectId,
        createdByAdminId: adminId,
        status: 'completed',
    })
        .sort({ createdAt: 1 })
        .lean();

    if (extractions.length === 0) {
        return res.status(404).json({ error: 'No completed extractions found for this project.' });
    }

    // Fetch project details — increment transmittal counter if this is a transmittal download
    let projectDetails = {
        projectName: 'Project',
        clientName: 'UNKNOWN CLIENT',
        transmittalNo: 1,
    };
    const type = req.query.type || null;
    try {
        let proj;
        if (!type || type === 'transmittal') {
            // Atomically increment transmittalCount and get the new value
            proj = await Project.findByIdAndUpdate(
                projectId,
                { $inc: { transmittalCount: 1 } },
                { new: true }
            ).lean();
        } else {
            proj = await Project.findById(projectId).lean();
        }
        if (proj) {
            projectDetails.projectName = proj.name || projectDetails.projectName;
            projectDetails.clientName = proj.clientName || projectDetails.clientName;
            projectDetails.transmittalNo = proj.transmittalCount || 1;
        }
    } catch (_) { /* non-fatal */ }

    // Generate fresh Excel with Drawing Log + Extraction Data sheets
    const { buffer, filename } = await generateProjectExcel(extractions, projectDetails, type);

    // ── Feature 6: Also save Excel to the uploaded folder path ─────────
    try {
        const firstWithLocalPath = extractions.find(e => e.localSavePath);
        const firstFileUrl = extractions.find(e => e.fileUrl)?.fileUrl;

        let sourceDir = null;
        if (firstWithLocalPath && firstWithLocalPath.localSavePath.trim()) {
            sourceDir = firstWithLocalPath.localSavePath.trim();
        } else if (firstFileUrl) {
            sourceDir = path.dirname(firstFileUrl);
        }

        if (sourceDir && fs.existsSync(sourceDir)) {
            const destPath = path.join(sourceDir, filename);
            fs.writeFileSync(destPath, buffer);
            console.log(`[Excel] Saved copy to local folder: ${destPath}`);
        }
    } catch (saveErr) {
        // Non-fatal: log but don't block the download
        console.error('[Excel] Failed to save to local folder:', saveErr.message);
    }

    res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}"`
    );
    res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.send(buffer);
};

// ── Delete Extraction ─────────────────────────────────────
exports.deleteExtraction = async (req, res) => {
    const { projectId, id } = req.params;
    const adminId = req.principal.adminId;

    const doc = await DrawingExtraction.findOneAndDelete({
        _id: id,
        projectId,
        createdByAdminId: adminId,
    });

    if (!doc) {
        return res.status(404).json({ error: 'Extraction not found.' });
    }

    // Delete uploaded PDF if present
    if (doc.fileUrl && fs.existsSync(doc.fileUrl)) {
        fs.unlinkSync(doc.fileUrl);
    }

    res.json({ message: 'Extraction deleted.' });
};
