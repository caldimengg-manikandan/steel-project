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
const mongoose = require('mongoose');
const DrawingExtraction = require('../models/DrawingExtraction');
const Project = require('../models/Project');
const { runExtractionPipeline } = require('../services/extractionService');
const { getProjectExcelPath, generateProjectExcel } = require('../services/excelService');
const SystemSettings = require('../models/SystemSettings');

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
    // The frontend MUST call /reserve-transmittal first and pass the reserved number here.
    const rawTN = req.body.targetTransmittalNumber;
    let targetTransmittalNumber = rawTN != null && rawTN !== '' ? parseInt(rawTN, 10) : null;

    let sequences = [];
    if (req.body.sequences) {
        sequences = Array.isArray(req.body.sequences) ? req.body.sequences : [req.body.sequences];
    }

    const category = req.body.category || req.body.purpose || '';

    // Filter and determine folder name
    const validFiles = [];
    req.files.forEach((file, i) => {
        const fullPath = pathArray[i] || file.originalname;
        const lowerPath = fullPath.toLowerCase();

        let folderName = '';
        const titleRegex = /(d[\s\-]*sheets?|detail[\s\-]*sheets?|e[\s\-]*sheets?|erection[\s\-]*sheets?)/i;
        let matchedTitle = null;
        const inFolder = fullPath.includes('/') || fullPath.includes('\\');

        if (fullPath.includes('/')) {
            const parts = fullPath.split('/');
            for (let i = 0; i < parts.length - 1; i++) {
                if (titleRegex.test(parts[i].trim())) {
                    matchedTitle = parts[i].trim();
                }
            }
        } else if (fullPath.includes('\\')) {
            const parts = fullPath.split('\\');
            for (let i = 0; i < parts.length - 1; i++) {
                if (titleRegex.test(parts[i].trim())) {
                    matchedTitle = parts[i].trim();
                }
            }
        }

        if (inFolder && !matchedTitle) {
            console.log(`[Upload] Skipping file not in an allowed drawing folder: ${fullPath}`);
            return; // skip this file
        }

        if (matchedTitle) {
            if (/^(d[\s\-]*sheets?|detail[\s\-]*sheets?)$/i.test(matchedTitle)) {
                folderName = 'DETAIL SHEET';
            } else if (/^(e[\s\-]*sheets?|erection[\s\-]*sheets?)$/i.test(matchedTitle)) {
                folderName = 'ERECTION SHEET';
            } else {
                folderName = matchedTitle.toUpperCase();
            }
        } else {
            const parts = fullPath.replace(/\\/g, '/').split('/');
            folderName = parts.length > 1 ? parts[parts.length - 2].trim().toUpperCase() : 'DRAWINGS';
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
        fileUrl: file.path || '', // BRIDGE PATH
        oneDriveFileId: file.oneDriveFileId || '',
        oneDriveUrl: file.webUrl || '',
        storageGatewayPath: file.storageGatewayPath || '', // Windows Server Storage path
        gridFsFileId: file.gridFsFileId || null,
        folderName,
        fileSize: file.size,
        uploadedBy,
        localSavePath,
        targetTransmittalNumber,
        sequences,
        category,
        status: 'queued',
    }));

    // ── Pre-cleanup removed: overwrite logic is handled safely by extractionService.js post-processing ──

    // Batch insert for performance
    const savedDocs = await DrawingExtraction.insertMany(extractionDocs);

    // Trigger background extraction for each
    for (const doc of savedDocs) {
        // Use the local bridge path for immediate extraction (Bridge Method)
        const fileRef = doc.fileUrl || doc.oneDriveFileId;

        runExtractionPipeline(
            doc._id.toString(),
            fileRef,
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

    if (typeof projectId === 'string' && projectId.startsWith('ext-')) {
        return res.json({ extractions: [], hasExcel: false, excelDownloadUrl: null });
    }

    const extractions = await DrawingExtraction.find({
        projectId,
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
        createdByAdminId: adminId
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
        createdByAdminId: adminId
    });

    if (!doc) {
        return res.status(404).json({ error: 'Extraction not found.' });
    }

    const fileRef = doc.storageGatewayPath || doc.oneDriveFileId || doc.fileUrl || doc.gridFsFileId;
    if (!fileRef) {
        return res.status(400).json({ error: 'Original file reference missing. Please re-upload.' });
    }

    // Check if it's a local file and if it exists
    if (!doc.storageGatewayPath && !doc.oneDriveFileId && !doc.gridFsFileId && doc.fileUrl && !fs.existsSync(doc.fileUrl)) {
        return res.status(400).json({ error: 'Original local file no longer exists on disk. Please re-upload.' });
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
    runExtractionPipeline(id, fileRef.toString(), projectId).catch((err) => {
        console.error('[Reprocess] Pipeline error:', err.message);
    });
};

// ── View PDF (Stream from GridFS/Disk) ─────────────────────
exports.viewPdf = async (req, res) => {
    const { projectId, id } = req.params;
    const adminId = req.principal.adminId;

    const doc = await DrawingExtraction.findOne({
        _id: id,
        projectId,
        createdByAdminId: adminId
    }).lean();

    if (!doc) {
        return res.status(404).json({ error: 'Extraction not found.' });
    }

    // 0. Storage Gateway Mode
    if (doc.storageGatewayPath) {
        try {
            const storageGateway = require('../utils/storageGateway');
            if (storageGateway.isEnabled()) {
                const { stream, contentType, contentLength } = await storageGateway.getFileStream(doc.storageGatewayPath);
                res.setHeader('Content-Type', contentType || 'application/pdf');
                res.setHeader('Content-Disposition', 'inline; filename="' + doc.originalFileName + '"');
                if (contentLength) res.setHeader('Content-Length', contentLength);

                stream.pipe(res);
                return;
            }
        } catch (err) {
            console.warn('[ViewPdf] Storage Gateway stream failed (falling back to GridFS/Disk):', err.message);
            // Fallthrough to GridFS / Legacy Disk mode below
        }
    }

    // 1. OneDrive Mode
    if (doc.oneDriveFileId && !doc.oneDriveFileId.toLowerCase().endsWith('.pdf')) {
        try {
            const rclone = require('../utils/rcloneOneDrive');

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', 'inline; filename="' + doc.originalFileName + '"');

            rclone.streamFile(doc.oneDriveFileId, res);
            return;
        } catch (err) {
            console.error('[ViewPdf] Rclone stream failed:', err.message);
            return res.status(500).json({ error: 'Failed to stream file from OneDrive.' });
        }
    }

    // 2. GridFS Mode (Backward Compatibility)
    if (doc.gridFsFileId) {
        try {
            const { getBucket } = require('../utils/gridfs');
            const bucket = getBucket();

            res.setHeader('Content-Type', 'application/pdf');
            // Suggest inline viewing
            res.setHeader('Content-Disposition', 'inline; filename="' + doc.originalFileName + '"');

            const downloadStream = bucket.openDownloadStream(new mongoose.Types.ObjectId(doc.gridFsFileId));
            downloadStream.pipe(res);
            return;
        } catch (err) {
            console.error('[ViewPdf] GridFS stream failed:', err.message);
            return res.status(500).json({ error: 'Failed to stream file from Atlas.' });
        }
    }

    // 2. Legacy Disk Mode
    if (doc.fileUrl && fs.existsSync(doc.fileUrl)) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline; filename="' + doc.originalFileName + '"');
        return fs.createReadStream(doc.fileUrl).pipe(res);
    }

    return res.status(404).json({ error: 'Physical PDF file not found.' });
};

// ── Download Excel ────────────────────────────────────────
exports.downloadExcel = async (req, res) => {
    const { projectId } = req.params;
    const adminId = req.principal.adminId;

    // Fetch all completed extractions for this project (fresh, live data)
    const extractions = await DrawingExtraction.find({
        projectId,
        status: 'completed',
    })
        .sort({ createdAt: 1 })
        .lean();

    if (extractions.length === 0) {
        return res.status(404).json({ error: 'No completed extractions found for this project.' });
    }

    // Fetch project details
    let projectDetails = {
        projectName: 'Project',
        clientName: 'UNKNOWN CLIENT',
        transmittalNo: 1,
    };
    const type = req.query.type || null;
    try {
        let proj;
        // Never increment the transmittal version on a simple download.
        // It only increments when a new transmittal is EXPLICITLY generated.
        proj = await Project.findById(projectId).lean();
        if (proj) {
            projectDetails.projectName = proj.name || projectDetails.projectName;
            projectDetails.clientName = proj.clientName || projectDetails.clientName;

            // For projects with custom starting numbers or pending drafts, 
            // the counter might not have caught up to the targeted transmittal yet.
            const maxTargetNum = (extractions || []).reduce((max, e) => (e.targetTransmittalNumber > max ? e.targetTransmittalNumber : max), 0);
            projectDetails.transmittalNo = Math.max(proj.transmittalCount || 1, maxTargetNum);
        }
    } catch (_) { /* non-fatal */ }

    // Fetch system settings for logo
    const settings = await SystemSettings.findOne().lean();

    const Transmittal = require('../models/Transmittal');
    const { getDrawingLog } = require('../services/transmittalService');
    const { generateTransmittalExcel, generateDrawingLogExcel } = require('../services/transmittalExcelService');

    let buffer, filename;

    if (type === 'transmittal') {
        // Download ONLY the latest transmittal's data (today's uploaded batch)
        let targetTransmittal = await Transmittal.findOne({ projectId }).sort({ transmittalNumber: -1 }).lean();

        if (!targetTransmittal) {
            // Build virtual transmittal from the latest targetTransmittalNumber upload batch
            const targetNums = extractions.map(e => e.targetTransmittalNumber).filter(n => n != null);
            const maxTarget = targetNums.length > 0 ? Math.max(...targetNums) : 1;
            const latestBatch = extractions.filter(e => e.targetTransmittalNumber === maxTarget);
            const batchToUse = latestBatch.length > 0 ? latestBatch : extractions;

            targetTransmittal = {
                transmittalNumber: maxTarget,
                drawings: batchToUse.map(e => ({
                    drawingNumber: e.extractedFields?.drawingNumber || e.originalFileName || '',
                    drawingTitle: e.extractedFields?.drawingTitle || e.extractedFields?.drawingDescription || '',
                    revision: e.extractedFields?.revision || '0',
                    date: e.extractedFields?.date || '',
                    remarks: e.extractedFields?.remarks || 'ISSUED FOR APPROVAL',
                    folderName: e.folderName || '',
                    changeType: 'new',
                })),
            };
        }

        projectDetails.transmittalNo = targetTransmittal.transmittalNumber || projectDetails.transmittalNo;
        const result = await generateTransmittalExcel(targetTransmittal, projectDetails, settings?.logoPath);
        buffer = result.buffer;
        filename = result.filename;
    } else if (type === 'log') {
        const log = await getDrawingLog(projectId);
        if (log) {
            const result = await generateDrawingLogExcel(log, projectDetails, settings?.logoPath);
            buffer = result.buffer;
            filename = result.filename;
        } else {
            const result = await generateProjectExcel(extractions, projectDetails, type, settings?.logoPath);
            buffer = result.buffer;
            filename = result.filename;
        }
    } else {
        const result = await generateProjectExcel(extractions, projectDetails, type, settings?.logoPath);
        buffer = result.buffer;
        filename = result.filename;
    }

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

    // ── Save Excel to Storage Gateway ─────────
    try {
        const storageGateway = require('../utils/storageGateway');
        if (storageGateway.isEnabled()) {
            const safeProjectName = projectDetails.projectName.replace(/[^a-zA-Z0-9 _-]/g, '_');
            const targetDir = `Projects/${safeProjectName}/Logs`;
            console.log(`[Excel] Uploading Excel to Storage Gateway: ${targetDir}/${filename}`);
            await storageGateway.uploadFile(targetDir, filename, buffer);
            console.log(`[Excel] Storage Gateway Upload complete.`);
        }
    } catch (gwErr) {
        console.error('[Excel] Failed to upload to Storage Gateway:', gwErr.message);
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
    });

    if (!doc) {
        return res.status(404).json({ error: 'Extraction not found.' });
    }

    // Delete from Storage Gateway if present
    if (doc.storageGatewayPath) {
        try {
            const storageGateway = require('../utils/storageGateway');
            if (storageGateway.isEnabled()) {
                await storageGateway.deleteFile(doc.storageGatewayPath);
                console.log(`[Delete] Storage Gateway file ${doc.storageGatewayPath} deleted.`);
            }
        } catch (err) {
            console.error('[Delete] Failed to remove Storage Gateway file:', err.message);
        }
    }

    // Delete uploaded PDF from OneDrive if present
    if (doc.oneDriveFileId) {
        try {
            const rclone = require('../utils/rcloneOneDrive');
            await rclone.deleteFile(doc.oneDriveFileId);
            console.log(`[Delete] OneDrive file ${doc.oneDriveFileId} deleted via Rclone.`);
        } catch (err) {
            console.error('[Delete] Failed to remove OneDrive file via Rclone:', err.message);
        }
    }

    // Delete uploaded PDF from GridFS if present (Compatibility)
    if (doc.gridFsFileId) {
        try {
            const { getBucket } = require('../utils/gridfs');
            const bucket = getBucket();
            await bucket.delete(new mongoose.Types.ObjectId(doc.gridFsFileId));
            console.log(`[Delete] GridFS file ${doc.gridFsFileId} deleted.`);
        } catch (err) {
            console.error('[Delete] Failed to remove GridFS file:', err.message);
        }
    }

    // Legacy: Delete local file if present
    if (doc.fileUrl && fs.existsSync(doc.fileUrl)) {
        try { fs.unlinkSync(doc.fileUrl); } catch (_) { }
    }

    res.json({ message: 'Extraction deleted.' });
};
