const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const Project = require('../models/Project');
const RfiExtraction = require('../models/RfiExtraction');
const SystemSettings = require('../models/SystemSettings');
const { generateRfiLogExcel } = require('../services/rfiExcelService');
const { runRfiExtraction } = require('../services/rfiExtractionService');

// Handle PDF uploads for RFI extraction
exports.uploadRfiDrawing = async (req, res) => {
    const { projectId } = req.params;
    const adminId = req.principal.adminId;
    const uploadedBy = req.principal.username;
    const { localSavePath, sequences } = req.body;

    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No PDF files uploaded.' });
    }

    const createdExtractions = [];

    const project = req.scopedProject;
    const projectName = project ? project.name.replace(/[^a-zA-Z0-9 _-]/g, '_') : 'Unknown_Project';

    // Process each file
    for (const file of req.files) {
        let storageGatewayPath = '';
        let uploadedToGateway = false;

        // Try Storage Gateway first
        try {
            const storageGateway = require('../utils/storageGateway');
            if (storageGateway.isEnabled()) {
                let baseTarget = `Projects/${projectName}/RFIs`;
                if (localSavePath) {
                    baseTarget += `/${localSavePath.split(/[\\\\/]+/).filter(Boolean).join('/')}`;
                }
                const cleanTargetDir = baseTarget.split(new RegExp('/+')).filter(Boolean).join('/').replace(new RegExp('/$'), '').replace(new RegExp('/\\\\.$'), '');
                
                let lastError = null;
                const maxRetries = 3;
                const baseDelay = 1000;

                for (let attempt = 1; attempt <= maxRetries; attempt++) {
                    try {
                        const fileBuffer = fs.readFileSync(file.path);
                        await storageGateway.uploadFile(cleanTargetDir, file.originalname, fileBuffer);
                        storageGatewayPath = `${cleanTargetDir}/${file.originalname}`;
                        console.log(`[RfiUpload] Stored: ${storageGatewayPath} (Attempt ${attempt})`);
                        uploadedToGateway = true;
                        break;
                    } catch (err) {
                        lastError = err;
                        const waitTime = baseDelay * attempt;
                        console.warn(`[RfiUpload] Attempt ${attempt} failed for ${file.originalname}. Retrying...`);
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                    }
                }
                if (!uploadedToGateway) {
                    console.warn(`[RfiUpload] Gateway upload failed, falling back to GridFS/Local. Error: ${lastError?.message}`);
                }
            }
        } catch (sgErr) {
            console.error('[RfiUpload] Storage Gateway init error:', sgErr.message);
        }

        let gridFsFileId = file.gridFsFileId || null;
        if (!uploadedToGateway && !gridFsFileId && file.path && fs.existsSync(file.path)) {
            try {
                const { getBucket } = require('../utils/gridfs');
                const bucket = getBucket();
                if (bucket) {
                    const uploadStream = bucket.openUploadStream(path.basename(file.path), {
                        contentType: file.mimetype || 'application/pdf',
                        metadata: { originalName: file.originalname, projectId }
                    });
                    fs.createReadStream(file.path).pipe(uploadStream);
                    await new Promise((resolve) => {
                        uploadStream.on('finish', () => {
                            gridFsFileId = uploadStream.id.toString();
                            resolve();
                        });
                        uploadStream.on('error', () => resolve());
                    });
                }
            } catch (gfsErr) {
                console.error('[RfiUpload] GridFS upload failed:', gfsErr.message);
            }
        }

        const doc = await RfiExtraction.create({
            projectId,
            createdByAdminId: adminId,
            uploadedBy,
            originalFileName: file.originalname,
            folderName: localSavePath || '',
            fileUrl: file.path || '',
            oneDriveFileId: file.oneDriveFileId || '', 
            oneDriveUrl: file.webUrl || '', 
            storageGatewayPath: file.storageGatewayPath || storageGatewayPath || localSavePath || '',
            gridFsFileId: gridFsFileId,
            status: 'queued',
            sequences: sequences || [],
        });
        createdExtractions.push(doc);

        try {
            const delResult = await RfiExtraction.deleteMany({
                projectId: new mongoose.Types.ObjectId(projectId),
                originalFileName: file.originalname,
                _id: { $ne: doc._id }
            });
            if (delResult.deletedCount > 0) {
                console.log(`[RfiUpload] Cleaned ${delResult.deletedCount} old RFI records for ${file.originalname}`);
            }
        } catch (cleanErr) {
            console.error('[RfiUpload] Cleanup error:', cleanErr.message);
        }

        // process in background using local bridge ref first
        const fileRef = doc.fileUrl || doc.oneDriveFileId;
        runRfiExtraction(doc._id, fileRef);
    }

    res.status(202).json({
        message: `${createdExtractions.length} RFI drawing(s) scheduled for extraction.`,
        extractions: createdExtractions
    });
};

// List RFIs for the project
exports.listRfiExtractions = async (req, res) => {
    try {
        const { projectId } = req.params;
        const adminId = req.principal.adminId;

        if (typeof projectId === 'string' && projectId.startsWith('ext-')) {
            return res.json({ extractions: [] });
        }

        const extractions = await RfiExtraction.find({ projectId })
            .sort({ createdAt: -1 })
            .lean();

        // Any RFI that has a response attachment uploaded must be considered closed
        for (const ext of extractions) {
            if (Array.isArray(ext.rfis)) {
                for (const r of ext.rfis) {
                    if (r.responseAttachmentUrl || r.responseAttachmentName || r.responseAttachmentGridFsId || r.responseAttachmentStorageGatewayPath) {
                        r.status = 'CLOSED';
                    }
                }
            }
        }

        res.json({ extractions });
    } catch (err) {
        console.error('[RfiController] list error:', err);
        res.status(500).json({ error: 'Failed to fetch RFI extractions.' });
    }
};

// Download Excel
exports.downloadRfiExcel = async (req, res) => {
    const { projectId } = req.params;
    const adminId = req.principal.adminId;

    try {
        const query = {
            projectId,
            status: 'completed'
        };

        if (req.query.extractionId) {
            query._id = req.query.extractionId;
        }

        const extractions = (await RfiExtraction.find(query).lean()) || [];

        const publicUrl = process.env.PUBLIC_SERVER_URL;
        const hostHeader = req.get('host') || '';
        const isHttps = req.headers['x-forwarded-proto'] === 'https' || req.protocol === 'https';
        const protocol = isHttps ? 'https' : 'http';

        // In hosted environment, hostHeader already contains domain/port (e.g. app.mydomain.com)
        const serverOrigin = publicUrl 
            ? publicUrl.replace(/\/$/, '') 
            : `${protocol}://${hostHeader}/api`;

        const queryBase = req.query.baseUrl || '';
        let baseUrl = queryBase || serverOrigin;
        
        // If queryBase contains localhost but request came from a domain or remote IP, use serverOrigin
        if (queryBase && queryBase.includes('localhost') && !hostHeader.includes('localhost')) {
            baseUrl = serverOrigin;
        }

        const isExternal = !!queryBase && !baseUrl.includes(hostHeader);

        // Generate a tiny viewer token for the Excel links so they don't exceed Excel's 255 character limit,
        // and so clients can view the PDFs without needing an admin login.
        const jwt = require('jsonwebtoken');
        const token = jwt.sign({ role: 'viewer' }, process.env.JWT_SECRET, { expiresIn: '30d' });
        
        const rfiStatus = req.query.status; // OPEN or CLOSED

        const project = await Project.findById(projectId).lean();
        const settings = await SystemSettings.findOne().lean();

        const projectDetails = {
            projectName: project ? project.name : 'Project',
            clientName: project ? project.clientName : 'CUSTOMER',
            projectNo: project ? project.projectNumber : '',
            logoPath: settings?.logoPath || ''
        };

        const apiRoot = serverOrigin.replace(/\/api$/, '');
        const { buffer, filename } = await generateRfiLogExcel(extractions, projectDetails, baseUrl, isExternal, token, rfiStatus, apiRoot);

        // If filtering by status, it's possible the buffer is nearly empty headers-only
        // But generateRfiLogExcel currently generates a file even if allRfis.length is 0.
        // We could check if allRfis.length was 0 in the service, but for now this is fine.

        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (err) {
        console.error('[RfiController] download error:', err);
        res.status(500).json({ error: 'Failed to generate RFI Excel log.' });
    }
};

// Update response/remarks for a single RFI item within an extraction
exports.updateRfiResponse = async (req, res) => {
    const { projectId, id, rfiIndex } = req.params;
    const adminId = req.principal.adminId;
    const { response, remarks } = req.body;

    const idx = parseInt(rfiIndex, 10);
    if (isNaN(idx) || idx < 0) {
        return res.status(400).json({ error: 'Invalid rfiIndex.' });
    }

    try {
        const extraction = await RfiExtraction.findOne({ _id: id, projectId });
        if (!extraction) return res.status(404).json({ error: 'RFI extraction not found.' });

        if (!extraction.rfis[idx]) {
            return res.status(404).json({ error: `RFI item at index ${idx} not found.` });
        }

        const { response, remarks, clientRfiNumber, status: reqStatus } = req.body;
        const reqResponse = response !== undefined ? response : extraction.rfis[idx].response;
        const reqRemarks = remarks !== undefined ? remarks : extraction.rfis[idx].remarks;
        const reqClientRfiNumber = clientRfiNumber !== undefined ? clientRfiNumber : extraction.rfis[idx].clientRfiNumber;

        const hasAttachment = !!(
            extraction.rfis[idx].responseAttachmentUrl || 
            extraction.rfis[idx].responseAttachmentName ||
            extraction.rfis[idx].responseAttachmentGridFsId ||
            extraction.rfis[idx].responseAttachmentStorageGatewayPath
        );
        const hasText = reqResponse && reqResponse.trim() !== '';
        const hasResponse = hasText || hasAttachment;

        let newStatus = 'OPEN';
        if (reqStatus && ['OPEN', 'CLOSED'].includes(reqStatus.toUpperCase())) {
            newStatus = reqStatus.toUpperCase();
        } else {
            newStatus = hasResponse ? 'CLOSED' : 'OPEN';
        }

        const oldStatus = extraction.rfis[idx].status;

        // If response text is empty but an attachment exists, default to [Attached]: filename
        let finalResponse = reqResponse || '';
        if (!finalResponse.trim() && hasAttachment && extraction.rfis[idx].responseAttachmentName) {
            finalResponse = `[Attached]: ${extraction.rfis[idx].responseAttachmentName}`;
        }

        extraction.rfis[idx].response = finalResponse;
        extraction.rfis[idx].remarks = reqRemarks || '';
        extraction.rfis[idx].clientRfiNumber = reqClientRfiNumber || '';
        extraction.rfis[idx].status = newStatus;

        if (newStatus === 'CLOSED' && oldStatus !== 'CLOSED') {
            extraction.rfis[idx].closedOn = new Date();
        } else if (newStatus === 'OPEN') {
            extraction.rfis[idx].closedOn = undefined;
        }

        await extraction.save();

        res.json({ message: 'Response/Remarks saved.', rfi: extraction.rfis[idx] });
    } catch (err) {
        console.error('[RfiController] updateRfiResponse error:', err);
        res.status(500).json({ error: 'Failed to save response.' });
    }
};

// Update status (OPEN / CLOSED) for a single RFI item
exports.updateRfiStatus = async (req, res) => {
    const { projectId, id, rfiIndex } = req.params;
    const { status } = req.body;

    const VALID = ['OPEN', 'CLOSED'];
    if (!status || !VALID.includes(status.toUpperCase())) {
        return res.status(400).json({ error: `status must be one of: ${VALID.join(', ')}` });
    }

    const idx = parseInt(rfiIndex, 10);
    if (isNaN(idx) || idx < 0) {
        return res.status(400).json({ error: 'Invalid rfiIndex.' });
    }

    try {
        const extraction = await RfiExtraction.findOne({ _id: id, projectId });
        if (!extraction) return res.status(404).json({ error: 'RFI extraction not found.' });

        if (!extraction.rfis[idx]) {
            return res.status(404).json({ error: `RFI item at index ${idx} not found.` });
        }

        extraction.rfis[idx].status = status.toUpperCase();
        if (status.toUpperCase() === 'CLOSED') {
            extraction.rfis[idx].closedOn = new Date();
        } else {
            extraction.rfis[idx].closedOn = undefined;
        }
        await extraction.save();

        res.json({ message: 'Status updated.', rfi: extraction.rfis[idx] });
    } catch (err) {
        console.error('[RfiController] updateRfiStatus error:', err);
        res.status(500).json({ error: 'Failed to update status.' });
    }
};


// Delete single RFI extraction
exports.deleteRfiExtraction = async (req, res) => {
    const { projectId, id } = req.params;

    try {
        const doc = await RfiExtraction.findOneAndDelete({ _id: id, projectId });
        if (!doc) return res.status(404).json({ error: 'RFI extraction not found.' });

        // Delete from Storage Gateway if present
        if (doc.storageGatewayPath) {
            try {
                const storageGateway = require('../utils/storageGateway');
                if (storageGateway.isEnabled()) {
                    await storageGateway.deleteFile(doc.storageGatewayPath);
                    console.log(`[DeleteRFI] Storage Gateway file ${doc.storageGatewayPath} deleted.`);
                }
            } catch (err) {
                console.error('[DeleteRFI] Failed to remove Storage Gateway file:', err.message);
            }
        }

        // Delete from OneDrive if present
        if (doc.oneDriveFileId) {
            try {
                const rclone = require('../utils/rcloneOneDrive');
                await rclone.deleteFile(doc.oneDriveFileId);
                console.log(`[DeleteRFI] OneDrive file ${doc.oneDriveFileId} deleted via Rclone.`);
            } catch (err) {
                console.error('[DeleteRFI] Failed to remove OneDrive file via Rclone:', err.message);
            }
        }

        // Delete from GridFS if present (Compatibility)
        if (doc.gridFsFileId) {
            try {
                const { getBucket } = require('../utils/gridfs');
                const bucket = getBucket();
                const mongoose = require('mongoose');
                await bucket.delete(new mongoose.Types.ObjectId(doc.gridFsFileId));
                console.log(`[DeleteRFI] GridFS file ${doc.gridFsFileId} deleted.`);
            } catch (err) {
                console.error('[DeleteRFI] Failed to remove GridFS file:', err.message);
            }
        }

        // Legacy/disk or attachment cleanup
        if (doc.fileUrl) {
            const p = path.join(__dirname, '../../', doc.fileUrl);
            if (fs.existsSync(p)) {
                try { fs.unlinkSync(p); } catch (_) {}
            }
        }

        res.json({ message: 'RFI extraction deleted successfully.' });
    } catch (error) {
        console.error('[RfiController] Delete failed:', error);
        res.status(500).json({ error: 'Failed to delete.' });
    }
};

// Upload attachment for an RFI response
exports.uploadRfiResponseAttachment = async (req, res) => {
    const { projectId, id, rfiIndex } = req.params;

    if (!req.file) {
        return res.status(400).json({ error: 'No attachment uploaded.' });
    }

    const idx = parseInt(rfiIndex, 10);
    if (isNaN(idx) || idx < 0) {
        return res.status(400).json({ error: 'Invalid rfiIndex.' });
    }

    try {
        const extraction = await RfiExtraction.findOne({ _id: id, projectId });
        if (!extraction) return res.status(404).json({ error: 'RFI extraction not found.' });

        if (!extraction.rfis[idx]) {
            return res.status(404).json({ error: `RFI item at index ${idx} not found.` });
        }

        // 1. Persist to GridFS for cloud reliability across restarts
        let gridFsId = null;
        try {
            const { getBucket } = require('../utils/gridfs');
            const bucket = getBucket();
            if (bucket && req.file.path && fs.existsSync(req.file.path)) {
                const uploadStream = bucket.openUploadStream(req.file.filename, {
                    contentType: req.file.mimetype || 'application/octet-stream',
                    metadata: {
                        originalName: req.file.originalname,
                        projectId,
                        extractionId: id,
                        rfiIndex: idx,
                        type: 'rfi-response-attachment'
                    }
                });
                fs.createReadStream(req.file.path).pipe(uploadStream);
                await new Promise((resolve) => {
                    uploadStream.on('finish', () => {
                        gridFsId = uploadStream.id;
                        resolve();
                    });
                    uploadStream.on('error', (e) => {
                        console.warn('[RfiAttachment] GridFS upload failed:', e.message);
                        resolve();
                    });
                });
            }
        } catch (gfsErr) {
            console.warn('[RfiAttachment] GridFS error:', gfsErr.message);
        }

        // 2. Persist to Storage Gateway if enabled
        let storageGatewayPath = null;
        try {
            const storageGateway = require('../utils/storageGateway');
            if (storageGateway.isEnabled() && req.file.path && fs.existsSync(req.file.path)) {
                const project = await Project.findById(projectId).lean();
                const safeProjectName = (project?.name || 'Project').replace(/[<>:"/\\|?*]/g, '_');
                const targetDir = `Projects/${safeProjectName}/RFI_Attachments`;
                await storageGateway.uploadFile(req.file.path, targetDir, req.file.filename);
                storageGatewayPath = `${targetDir}/${req.file.filename}`;
            }
        } catch (sgErr) {
            console.warn('[RfiAttachment] Storage Gateway upload error:', sgErr.message);
        }

        // Store the local URL & backup pointers for the response attachment
        extraction.rfis[idx].responseAttachmentUrl = `/uploads/steel-dms-uploads/${req.file.filename}`;
        extraction.rfis[idx].responseAttachmentName = req.file.originalname;
        if (gridFsId) extraction.rfis[idx].responseAttachmentGridFsId = gridFsId;
        if (storageGatewayPath) extraction.rfis[idx].responseAttachmentStorageGatewayPath = storageGatewayPath;
        extraction.rfis[idx].status = 'CLOSED';
        extraction.rfis[idx].closedOn = new Date();

        // Optional: also store "Attached: file_name" in the text response if it's empty
        if (!extraction.rfis[idx].response || extraction.rfis[idx].response.trim() === '') {
            extraction.rfis[idx].response = `[Attached]: ${req.file.originalname}`;
        }

        await extraction.save();

        res.json({ 
            message: 'Attachment uploaded and RFI closed.', 
            rfi: extraction.rfis[idx] 
        });
    } catch (err) {
        console.error('[RfiController] uploadRfiResponseAttachment error:', err);
        res.status(500).json({ error: 'Failed to upload response attachment.' });
    }
};

// Stream response attachment for a specific RFI item (Disk -> Storage Gateway -> GridFS fallback)
exports.viewRfiAttachment = async (req, res) => {
    const { projectId, id, rfiIndex } = req.params;
    const idx = parseInt(rfiIndex, 10);

    try {
        const doc = await RfiExtraction.findOne({ _id: id, projectId });
        if (!doc || !doc.rfis || isNaN(idx) || !doc.rfis[idx]) {
            return res.status(404).json({ error: 'RFI item or attachment not found.' });
        }

        const rfi = doc.rfis[idx];
        if (!rfi.responseAttachmentUrl && !rfi.responseAttachmentGridFsId && !rfi.responseAttachmentStorageGatewayPath) {
            return res.status(404).json({ error: 'No attachment found for this RFI item.' });
        }

        const rawUrl = rfi.responseAttachmentUrl || '';
        const filename = rawUrl ? path.basename(rawUrl.replace(/\\/g, '/')) : '';
        const originalName = rfi.responseAttachmentName || filename || 'attachment';
        const ext = path.extname(originalName).toLowerCase();
        const contentTypes = {
            '.pdf': 'application/pdf',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.doc': 'application/msword',
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            '.xls': 'application/vnd.ms-excel',
            '.csv': 'text/csv',
            '.txt': 'text/plain'
        };

        // 1. Try local disk paths
        if (filename) {
            const candidatePaths = [
                path.join(__dirname, '../../uploads/steel-dms-uploads', filename),
                path.join(__dirname, '../../../uploads/steel-dms-uploads', filename),
                path.resolve(process.cwd(), 'uploads/steel-dms-uploads', filename),
                path.resolve(process.cwd(), 'backend/uploads/steel-dms-uploads', filename),
            ];

            for (const p of candidatePaths) {
                if (fs.existsSync(p)) {
                    res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream');
                    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(originalName)}"`);
                    return fs.createReadStream(p).pipe(res);
                }
            }
        }

        // 2. Try Storage Gateway
        if (rfi.responseAttachmentStorageGatewayPath) {
            try {
                const storageGateway = require('../utils/storageGateway');
                if (storageGateway.isEnabled() && await storageGateway.fileExists(rfi.responseAttachmentStorageGatewayPath)) {
                    const stream = await storageGateway.getFileStream(rfi.responseAttachmentStorageGatewayPath);
                    res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream');
                    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(originalName)}"`);
                    return stream.pipe(res);
                }
            } catch (sgErr) {
                console.warn('[RfiAttachment] Storage Gateway stream error:', sgErr.message);
            }
        }

        // 3. Try GridFS
        try {
            const { getBucket } = require('../utils/gridfs');
            const bucket = getBucket();
            if (bucket) {
                let fileId = rfi.responseAttachmentGridFsId;
                if (!fileId && filename) {
                    const gfile = await bucket.find({ filename }).next();
                    if (gfile) fileId = gfile._id;
                }
                if (fileId) {
                    res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream');
                    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(originalName)}"`);
                    const downloadStream = bucket.openDownloadStream(new mongoose.Types.ObjectId(fileId));
                    return downloadStream.pipe(res);
                }
            }
        } catch (gfsErr) {
            console.warn('[RfiAttachment] GridFS stream error:', gfsErr.message);
        }

        return res.status(404).json({ error: 'Attachment file not found on disk or remote storage.' });
    } catch (err) {
        console.error('[RfiController] viewRfiAttachment failed:', err);
        res.status(500).json({ error: 'Internal error viewing attachment.' });
    }
};

// Delete response attachment from an RFI item
exports.deleteRfiResponseAttachment = async (req, res) => {
    const { projectId, id, rfiIndex } = req.params;
    const idx = parseInt(rfiIndex, 10);

    if (isNaN(idx) || idx < 0) {
        return res.status(400).json({ error: 'Invalid rfiIndex.' });
    }

    try {
        const extraction = await RfiExtraction.findOne({ _id: id, projectId });
        if (!extraction) return res.status(404).json({ error: 'RFI extraction not found.' });

        if (!extraction.rfis || !extraction.rfis[idx]) {
            return res.status(404).json({ error: `RFI item at index ${idx} not found.` });
        }

        const rfi = extraction.rfis[idx];
        if (!rfi.responseAttachmentUrl && !rfi.responseAttachmentGridFsId && !rfi.responseAttachmentStorageGatewayPath) {
            return res.status(400).json({ error: 'No attachment found on this RFI item.' });
        }

        // 1. Delete from local disk
        if (rfi.responseAttachmentUrl) {
            const filename = path.basename(rfi.responseAttachmentUrl.replace(/\\/g, '/'));
            const candidatePaths = [
                path.join(__dirname, '../../uploads/steel-dms-uploads', filename),
                path.join(__dirname, '../../../uploads/steel-dms-uploads', filename),
                path.resolve(process.cwd(), 'uploads/steel-dms-uploads', filename),
                path.resolve(process.cwd(), 'backend/uploads/steel-dms-uploads', filename),
            ];
            candidatePaths.forEach(p => {
                if (fs.existsSync(p)) {
                    try { fs.unlinkSync(p); } catch (_) {}
                }
            });
        }

        // 2. Delete from GridFS
        if (rfi.responseAttachmentGridFsId) {
            try {
                const { getBucket } = require('../utils/gridfs');
                const bucket = getBucket();
                if (bucket) {
                    await bucket.delete(new mongoose.Types.ObjectId(rfi.responseAttachmentGridFsId));
                }
            } catch (gfsErr) {
                console.warn('[RfiAttachment] GridFS delete error:', gfsErr.message);
            }
        }

        // 3. Delete from Storage Gateway
        if (rfi.responseAttachmentStorageGatewayPath) {
            try {
                const storageGateway = require('../utils/storageGateway');
                if (storageGateway.isEnabled()) {
                    await storageGateway.deleteFile(rfi.responseAttachmentStorageGatewayPath);
                }
            } catch (sgErr) {
                console.warn('[RfiAttachment] Storage Gateway delete error:', sgErr.message);
            }
        }

        // If response text was auto-set to `[Attached]: <file>`, clean it up
        if (rfi.response && rfi.responseAttachmentName && rfi.response.trim() === `[Attached]: ${rfi.responseAttachmentName}`) {
            extraction.rfis[idx].response = '';
            extraction.rfis[idx].status = 'OPEN';
            extraction.rfis[idx].closedOn = undefined;
        }

        extraction.rfis[idx].responseAttachmentUrl = undefined;
        extraction.rfis[idx].responseAttachmentName = undefined;
        extraction.rfis[idx].responseAttachmentGridFsId = undefined;
        extraction.rfis[idx].responseAttachmentStorageGatewayPath = undefined;

        await extraction.save();

        res.json({
            message: 'Attachment deleted successfully.',
            rfi: extraction.rfis[idx]
        });
    } catch (err) {
        console.error('[RfiController] deleteRfiResponseAttachment error:', err);
        res.status(500).json({ error: 'Failed to delete attachment.' });
    }
};

// Stream source PDF for RFI extraction (GridFS / Disk)
exports.viewRfiPdf = async (req, res) => {
    const { projectId, id } = req.params;
    const adminId = req.principal.adminId;
    console.log(`[DEBUG viewRfiPdf] Start. projectId=${projectId}, id=${id}, adminId=${adminId}`);

    try {
        const doc = await RfiExtraction.findOne({ _id: id, projectId });
        if (!doc) {
            console.log('[DEBUG viewRfiPdf] Document not found in DB!');
            return res.status(404).json({ error: 'RFI extraction not found.' });
        }
        console.log(`[DEBUG viewRfiPdf] Found doc. originalFileName=${doc.originalFileName}, fileUrl=${doc.fileUrl}`);

        // 0. Storage Gateway Mode
        if (doc.storageGatewayPath) {
            console.log(`[DEBUG viewRfiPdf] Trying Storage Gateway. path=${doc.storageGatewayPath}`);
            try {
                const storageGateway = require('../utils/storageGateway');
                if (storageGateway.isEnabled()) {
                    const { stream, contentLength } = await storageGateway.getFileStream(doc.storageGatewayPath);
                    res.setHeader('Content-Type', 'application/pdf');
                    res.setHeader('Content-Disposition', 'inline; filename="' + encodeURIComponent(doc.originalFileName) + '"');
                    if (contentLength) res.setHeader('Content-Length', contentLength);
                    
                    stream.pipe(res);
                    return;
                }
            } catch (err) {
                console.warn('[ViewRfiPdf] Storage Gateway stream failed (falling back to GridFS/Disk):', err.message);
                // Fallthrough to GridFS / Legacy Disk mode below
            }
        }

        // 1. OneDrive Mode
        if (doc.oneDriveFileId && !doc.oneDriveFileId.toLowerCase().endsWith('.pdf')) {
            console.log(`[DEBUG viewRfiPdf] Trying OneDrive.`);
            try {
                const rclone = require('../utils/rcloneOneDrive');
                
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', 'inline; filename="' + encodeURIComponent(doc.originalFileName) + '"');
                
                rclone.streamFile(doc.oneDriveFileId, res);
                return;
            } catch (err) {
                console.error('[ViewRfiPdf] Rclone stream failed:', err.message);
                return res.status(500).json({ error: 'Failed to stream file from OneDrive.' });
            }
        }

        // 2. GridFS Mode (Compatibility)
        if (doc.gridFsFileId) {
            console.log(`[DEBUG viewRfiPdf] Trying GridFS.`);
            try {
                const { getBucket } = require('../utils/gridfs');
                const bucket = getBucket();
                const mongoose = require('mongoose');
                
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', 'inline; filename="' + encodeURIComponent(doc.originalFileName) + '"');

                const downloadStream = bucket.openDownloadStream(new mongoose.Types.ObjectId(doc.gridFsFileId));
                downloadStream.pipe(res);
                return;
            } catch (err) {
                console.error('[ViewRfiPdf] GridFS stream failed:', err.message);
                return res.status(500).json({ error: 'Failed to stream file from Atlas.' });
            }
        }

        // 3. Legacy Disk Mode
        if (doc.fileUrl) {
            console.log(`[DEBUG viewRfiPdf] Trying Legacy Disk Mode.`);
            const filename = path.basename(doc.fileUrl.replace(/\\/g, '/'));
            const standardizedPath = path.join(__dirname, '../../uploads/steel-dms-uploads', filename);
            const originalPath = path.isAbsolute(doc.fileUrl) ? doc.fileUrl : path.join(__dirname, '../../', doc.fileUrl);
            
            const p = fs.existsSync(standardizedPath) ? standardizedPath : originalPath;
            console.log(`[DEBUG viewRfiPdf] Checking path p=${p}`);

            if (fs.existsSync(p)) {
                console.log(`[DEBUG viewRfiPdf] File exists! Streaming...`);
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', 'inline; filename="' + encodeURIComponent(doc.originalFileName) + '"');
                return fs.createReadStream(p).pipe(res);
            } else {
                console.log(`[DEBUG viewRfiPdf] File DOES NOT EXIST at ${p}`);
            }
        }

        console.log(`[DEBUG viewRfiPdf] Reached end of function without streaming. Returning 404.`);
        return res.status(404).json({ error: 'Physical PDF file not found.' });
    } catch (err) {
        console.error('[RfiController] viewPdf failed:', err);
        res.status(500).json({ error: 'Internal error viewing PDF.' });
    }
};
