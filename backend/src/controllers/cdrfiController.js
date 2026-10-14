const path = require('path');
const fs = require('fs');
const mongoose = require('mongoose');
const Project = require('../models/Project');
const CdrfiExtraction = require('../models/CdrfiExtraction');
const SystemSettings = require('../models/SystemSettings');
const { generateCdrfiLogExcel } = require('../services/cdrfiExcelService');
const { runCdrfiExtraction } = require('../services/cdrfiExtractionService');

// Handle PDF uploads for CDRFI extraction
exports.uploadCdrfiDrawing = async (req, res) => {
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
                let baseTarget = `Projects/${projectName}/CDRFIs`;
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
                        console.log(`[CdrfiUpload] Stored: ${storageGatewayPath} (Attempt ${attempt})`);
                        uploadedToGateway = true;
                        break;
                    } catch (err) {
                        lastError = err;
                        const waitTime = baseDelay * attempt;
                        console.warn(`[CdrfiUpload] Attempt ${attempt} failed for ${file.originalname}. Retrying...`);
                        await new Promise(resolve => setTimeout(resolve, waitTime));
                    }
                }
                if (!uploadedToGateway) {
                    console.warn(`[CdrfiUpload] Gateway upload failed, falling back to GridFS/Local. Error: ${lastError?.message}`);
                }
            }
        } catch (sgErr) {
            console.error('[CdrfiUpload] Storage Gateway init error:', sgErr.message);
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
                console.error('[CdrfiUpload] GridFS upload failed:', gfsErr.message);
            }
        }

        const doc = await CdrfiExtraction.create({
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
            const delResult = await CdrfiExtraction.deleteMany({
                projectId: new mongoose.Types.ObjectId(projectId),
                originalFileName: file.originalname,
                _id: { $ne: doc._id }
            });
            if (delResult.deletedCount > 0) {
                console.log(`[CdrfiUpload] Cleaned ${delResult.deletedCount} old CDRFI records for ${file.originalname}`);
            }
        } catch (cleanErr) {
            console.error('[CdrfiUpload] Cleanup error:', cleanErr.message);
        }

        const fileRef = doc.fileUrl || doc.oneDriveFileId;
        runCdrfiExtraction(doc._id, fileRef);
    }

    res.status(202).json({
        message: `${createdExtractions.length} CDRFI drawing(s) scheduled for extraction.`,
        extractions: createdExtractions
    });
};

// List CDRFIs for the project
exports.listCdrfiExtractions = async (req, res) => {
    try {
        const { projectId } = req.params;

        if (typeof projectId === 'string' && projectId.startsWith('ext-')) {
            return res.json({ extractions: [] });
        }

        const extractions = await CdrfiExtraction.find({ projectId })
            .sort({ createdAt: -1 })
            .lean();

        res.json({ extractions });
    } catch (err) {
        console.error('[CdrfiController] list error:', err);
        res.status(500).json({ error: 'Failed to fetch CDRFI extractions.' });
    }
};

// Download Excel
exports.downloadCdrfiExcel = async (req, res) => {
    const { projectId } = req.params;

    try {
        const query = {
            projectId,
            status: 'completed'
        };

        if (req.query.extractionId) {
            query._id = req.query.extractionId;
        }

        const extractions = await CdrfiExtraction.find(query).lean();

        if (extractions.length === 0) {
            return res.status(404).json({ error: 'No completed CDRFI extractions found.' });
        }

        const publicUrl = process.env.PUBLIC_SERVER_URL;
        const hostHeader = req.get('host') || '';
        const isHttps = req.headers['x-forwarded-proto'] === 'https' || req.protocol === 'https';
        const protocol = isHttps ? 'https' : 'http';

        const serverOrigin = publicUrl 
            ? publicUrl.replace(/\/$/, '') 
            : `${protocol}://${hostHeader}/api`;

        const queryBase = req.query.baseUrl || '';
        let baseUrl = queryBase || serverOrigin;
        
        if (queryBase && queryBase.includes('localhost') && !hostHeader.includes('localhost')) {
            baseUrl = serverOrigin;
        }

        const isExternal = !!queryBase && !baseUrl.includes(hostHeader);

        const jwt = require('jsonwebtoken');
        const token = jwt.sign({ role: 'viewer' }, process.env.JWT_SECRET, { expiresIn: '30d' });
        
        const rfiStatus = req.query.status;

        const project = await Project.findById(projectId).lean();
        const settings = await SystemSettings.findOne().lean();

        const projectDetails = {
            projectName: project ? project.name : 'Project',
            clientName: project ? project.clientName : 'CUSTOMER',
            projectNo: project ? project.projectNumber : '',
            logoPath: settings?.logoPath || ''
        };

        const apiRoot = serverOrigin.replace(/\/api$/, '');
        const { buffer, filename } = await generateCdrfiLogExcel(extractions, projectDetails, baseUrl, isExternal, token, rfiStatus, apiRoot);

        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (err) {
        console.error('[CdrfiController] download error:', err);
        res.status(500).json({ error: 'Failed to generate CDRFI Excel log.' });
    }
};

// Update response/remarks for a single CDRFI item within an extraction
exports.updateCdrfiResponse = async (req, res) => {
    const { projectId, id, rfiIndex } = req.params;
    const adminId = req.principal.adminId;

    const idx = parseInt(rfiIndex, 10);
    if (isNaN(idx) || idx < 0) {
        return res.status(400).json({ error: 'Invalid rfiIndex.' });
    }

    try {
        const extraction = await CdrfiExtraction.findOne({ _id: id, projectId });
        if (!extraction) return res.status(404).json({ error: 'CDRFI extraction not found.' });

        if (!extraction.rfis[idx]) {
            return res.status(404).json({ error: `CDRFI item at index ${idx} not found.` });
        }

        const { response, remarks, clientRfiNumber, status: reqStatus } = req.body;
        const reqResponse = response !== undefined ? response : extraction.rfis[idx].response;
        const reqRemarks = remarks !== undefined ? remarks : extraction.rfis[idx].remarks;
        const reqClientRfiNumber = clientRfiNumber !== undefined ? clientRfiNumber : extraction.rfis[idx].clientRfiNumber;

        const hasResponse = reqResponse && reqResponse.trim() !== '';

        let newStatus = 'OPEN';
        if (reqStatus && ['OPEN', 'CLOSED'].includes(reqStatus.toUpperCase())) {
            newStatus = reqStatus.toUpperCase();
        } else {
            newStatus = hasResponse ? 'CLOSED' : 'OPEN';
        }

        const oldStatus = extraction.rfis[idx].status;

        extraction.rfis[idx].response = reqResponse || '';
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
        console.error('[CdrfiController] updateCdrfiResponse error:', err);
        res.status(500).json({ error: 'Failed to save response.' });
    }
};

// Update status (OPEN / CLOSED) for a single CDRFI item
exports.updateCdrfiStatus = async (req, res) => {
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
        const extraction = await CdrfiExtraction.findOne({ _id: id, projectId });
        if (!extraction) return res.status(404).json({ error: 'CDRFI extraction not found.' });

        if (!extraction.rfis[idx]) {
            return res.status(404).json({ error: `CDRFI item at index ${idx} not found.` });
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
        console.error('[CdrfiController] updateCdrfiStatus error:', err);
        res.status(500).json({ error: 'Failed to update status.' });
    }
};

// Delete single CDRFI extraction
exports.deleteCdrfiExtraction = async (req, res) => {
    const { projectId, id } = req.params;

    try {
        const doc = await CdrfiExtraction.findOneAndDelete({ _id: id, projectId });
        if (!doc) return res.status(404).json({ error: 'CDRFI extraction not found.' });

        if (doc.storageGatewayPath) {
            try {
                const storageGateway = require('../utils/storageGateway');
                if (storageGateway.isEnabled()) {
                    await storageGateway.deleteFile(doc.storageGatewayPath);
                    console.log(`[DeleteCDRFI] Storage Gateway file ${doc.storageGatewayPath} deleted.`);
                }
            } catch (err) {
                console.error('[DeleteCDRFI] Failed to remove Storage Gateway file:', err.message);
            }
        }

        if (doc.oneDriveFileId) {
            try {
                const rclone = require('../utils/rcloneOneDrive');
                await rclone.deleteFile(doc.oneDriveFileId);
                console.log(`[DeleteCDRFI] OneDrive file ${doc.oneDriveFileId} deleted via Rclone.`);
            } catch (err) {
                console.error('[DeleteCDRFI] Failed to remove OneDrive file via Rclone:', err.message);
            }
        }

        if (doc.gridFsFileId) {
            try {
                const { getBucket } = require('../utils/gridfs');
                const bucket = getBucket();
                const mongoose = require('mongoose');
                await bucket.delete(new mongoose.Types.ObjectId(doc.gridFsFileId));
                console.log(`[DeleteCDRFI] GridFS file ${doc.gridFsFileId} deleted.`);
            } catch (err) {
                console.error('[DeleteCDRFI] Failed to remove GridFS file:', err.message);
            }
        }

        if (doc.fileUrl) {
            const p = path.join(__dirname, '../../', doc.fileUrl);
            if (fs.existsSync(p)) {
                try { fs.unlinkSync(p); } catch (_) {}
            }
        }

        res.json({ message: 'CDRFI extraction deleted successfully.' });
    } catch (error) {
        console.error('[CdrfiController] Delete failed:', error);
        res.status(500).json({ error: 'Failed to delete.' });
    }
};

// Upload attachment for a CDRFI response
exports.uploadCdrfiResponseAttachment = async (req, res) => {
    const { projectId, id, rfiIndex } = req.params;

    if (!req.file) {
        return res.status(400).json({ error: 'No attachment uploaded.' });
    }

    const idx = parseInt(rfiIndex, 10);
    if (isNaN(idx) || idx < 0) {
        return res.status(400).json({ error: 'Invalid rfiIndex.' });
    }

    try {
        const extraction = await CdrfiExtraction.findOne({ _id: id, projectId });
        if (!extraction) return res.status(404).json({ error: 'CDRFI extraction not found.' });

        if (!extraction.rfis[idx]) {
            return res.status(404).json({ error: `CDRFI item at index ${idx} not found.` });
        }

        extraction.rfis[idx].responseAttachmentUrl = `/uploads/steel-dms-uploads/${req.file.filename}`;
        extraction.rfis[idx].responseAttachmentName = req.file.originalname;
        extraction.rfis[idx].status = 'CLOSED';
        extraction.rfis[idx].closedOn = new Date();

        if (!extraction.rfis[idx].response || extraction.rfis[idx].response.trim() === '') {
            extraction.rfis[idx].response = `[Attached]: ${req.file.originalname}`;
        }

        await extraction.save();

        res.json({ 
            message: 'Attachment uploaded and CDRFI closed.', 
            rfi: extraction.rfis[idx] 
        });
    } catch (err) {
        console.error('[CdrfiController] uploadCdrfiResponseAttachment error:', err);
        res.status(500).json({ error: 'Failed to upload response attachment.' });
    }
};

// Stream response attachment for a specific CDRFI item
exports.viewCdrfiAttachment = async (req, res) => {
    const { projectId, id, rfiIndex } = req.params;
    const idx = parseInt(rfiIndex, 10);

    try {
        const doc = await CdrfiExtraction.findOne({ _id: id, projectId });
        if (!doc || !doc.rfis || isNaN(idx) || !doc.rfis[idx]) {
            return res.status(404).json({ error: 'CDRFI item or attachment not found.' });
        }

        const rfi = doc.rfis[idx];
        if (!rfi.responseAttachmentUrl) {
            return res.status(404).json({ error: 'No attachment found for this CDRFI item.' });
        }

        const filename = path.basename(rfi.responseAttachmentUrl.replace(/\\/g, '/'));
        const standardizedPath = path.join(__dirname, '../../uploads/steel-dms-uploads', filename);
        const altPath = path.join(__dirname, '../uploads/steel-dms-uploads', filename);
        const rootUploadsPath = path.join(__dirname, '../../../uploads/steel-dms-uploads', filename);
        const directPath = path.isAbsolute(rfi.responseAttachmentUrl) ? rfi.responseAttachmentUrl : path.join(__dirname, '../../', rfi.responseAttachmentUrl);

        let targetPath = null;
        if (fs.existsSync(standardizedPath)) targetPath = standardizedPath;
        else if (fs.existsSync(altPath)) targetPath = altPath;
        else if (fs.existsSync(rootUploadsPath)) targetPath = rootUploadsPath;
        else if (fs.existsSync(directPath)) targetPath = directPath;

        if (!targetPath) {
            return res.status(404).json({ error: 'Attachment file not found on disk.' });
        }

        const originalName = rfi.responseAttachmentName || filename;
        const ext = path.extname(originalName).toLowerCase();
        const contentTypes = {
            '.pdf': 'application/pdf',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        };

        res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(originalName)}"`);
        return fs.createReadStream(targetPath).pipe(res);
    } catch (err) {
        console.error('[CdrfiController] viewCdrfiAttachment failed:', err);
        res.status(500).json({ error: 'Internal error viewing attachment.' });
    }
};

// Stream source PDF for CDRFI extraction
exports.viewCdrfiPdf = async (req, res) => {
    const { projectId, id } = req.params;

    try {
        const doc = await CdrfiExtraction.findOne({ _id: id, projectId });
        if (!doc) {
            return res.status(404).json({ error: 'CDRFI extraction not found.' });
        }

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
                console.warn('[ViewCdrfiPdf] Storage Gateway stream failed:', err.message);
            }
        }

        if (doc.oneDriveFileId && !doc.oneDriveFileId.toLowerCase().endsWith('.pdf')) {
            try {
                const rclone = require('../utils/rcloneOneDrive');
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', 'inline; filename="' + doc.originalFileName + '"');
                rclone.streamFile(doc.oneDriveFileId, res);
                return;
            } catch (err) {
                console.error('[ViewCdrfiPdf] Rclone stream failed:', err.message);
                return res.status(500).json({ error: 'Failed to stream file from OneDrive.' });
            }
        }

        if (doc.gridFsFileId) {
            try {
                const { getBucket } = require('../utils/gridfs');
                const bucket = getBucket();
                const mongoose = require('mongoose');
                
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', 'inline; filename="' + doc.originalFileName + '"');

                const downloadStream = bucket.openDownloadStream(new mongoose.Types.ObjectId(doc.gridFsFileId));
                downloadStream.pipe(res);
                return;
            } catch (err) {
                console.error('[ViewCdrfiPdf] GridFS stream failed:', err.message);
                return res.status(500).json({ error: 'Failed to stream file from Atlas.' });
            }
        }

        if (doc.fileUrl) {
            const filename = path.basename(doc.fileUrl.replace(/\\/g, '/'));
            const standardizedPath = path.join(__dirname, '../../uploads/steel-dms-uploads', filename);
            const originalPath = path.isAbsolute(doc.fileUrl) ? doc.fileUrl : path.join(__dirname, '../../', doc.fileUrl);
            
            const p = fs.existsSync(standardizedPath) ? standardizedPath : originalPath;

            if (fs.existsSync(p)) {
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', 'inline; filename="' + doc.originalFileName + '"');
                return fs.createReadStream(p).pipe(res);
            }
        }

        return res.status(404).json({ error: 'Physical PDF file not found.' });
    } catch (err) {
        console.error('[CdrfiController] viewPdf failed:', err);
        res.status(500).json({ error: 'Internal error viewing PDF.' });
    }
};
