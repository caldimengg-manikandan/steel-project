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


    // Process each file
    for (const file of req.files) {
        const doc = await RfiExtraction.create({
            projectId,
            createdByAdminId: adminId,
            uploadedBy,
            originalFileName: file.originalname,
            folderName: localSavePath || '',
            fileUrl: file.path || '', // BRIDGE PATH
            oneDriveFileId: file.oneDriveFileId || '', 
            oneDriveUrl: file.webUrl || '', 
            storageGatewayPath: file.storageGatewayPath || '',
            gridFsFileId: file.gridFsFileId || null,
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
        const fileRef = doc.storageGatewayPath || doc.fileUrl || doc.oneDriveFileId || doc.gridFsFileId;
        runRfiExtraction(doc._id, fileRef);
    }

    res.status(202).json({
        message: `${createdExtractions.length} RFI drawing(s) scheduled for extraction.`,
        extractions: createdExtractions
    });
};

// List RFIs for the project
exports.listRfiExtractions = async (req, res) => {
    const { projectId } = req.params;
    const adminId = req.principal.adminId;

    if (typeof projectId === 'string' && projectId.startsWith('ext-')) {
        return res.json({ extractions: [] });
    }

    try {
        const extractions = await RfiExtraction.find({ projectId, createdByAdminId: adminId })
            .sort({ createdAt: -1 })
            .lean();

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

        const extractions = await RfiExtraction.find(query).lean();

        if (extractions.length === 0) {
            return res.status(404).json({ error: 'No completed RFI extractions found.' });
        }

        const serverOrigin = `${req.protocol}://${req.get('host')}/api`;
        const queryBase = req.query.baseUrl || '';
        const baseUrl = queryBase || serverOrigin;
        const isExternal = !!queryBase;

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

        const { buffer, filename } = await generateRfiLogExcel(extractions, projectDetails, baseUrl, isExternal, token, rfiStatus);

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
        const extraction = await RfiExtraction.findOne({ _id: id, projectId, createdByAdminId: adminId });
        if (!extraction) return res.status(404).json({ error: 'RFI extraction not found.' });

        if (!extraction.rfis[idx]) {
            return res.status(404).json({ error: `RFI item at index ${idx} not found.` });
        }

        const { response, remarks, clientRfiNumber } = req.body;
        const reqResponse = response !== undefined ? response : extraction.rfis[idx].response;
        const reqRemarks = remarks !== undefined ? remarks : extraction.rfis[idx].remarks;
        const reqClientRfiNumber = clientRfiNumber !== undefined ? clientRfiNumber : extraction.rfis[idx].clientRfiNumber;

        const hasResponse = reqResponse && reqResponse.trim() !== '';
        const hasRemarks = reqRemarks && reqRemarks.trim() !== '';

        let newStatus = 'OPEN';
        if (hasResponse && !hasRemarks) {
            newStatus = 'CLOSED';
        } else if (hasRemarks && !hasResponse) {
            newStatus = 'OPEN';
        } else if (hasResponse && hasRemarks) {
            newStatus = 'CLOSED';
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
        console.error('[RfiController] updateRfiResponse error:', err);
        res.status(500).json({ error: 'Failed to save response.' });
    }
};

// Update status (OPEN / CLOSED) for a single RFI item
exports.updateRfiStatus = async (req, res) => {
    const { projectId, id, rfiIndex } = req.params;
    const adminId = req.principal.adminId;
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
        const extraction = await RfiExtraction.findOne({ _id: id, projectId, createdByAdminId: adminId });
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
    const adminId = req.principal.adminId;

    try {
        const doc = await RfiExtraction.findOneAndDelete({ _id: id, projectId, createdByAdminId: adminId });
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
    const adminId = req.principal.adminId;

    if (!req.file) {
        return res.status(400).json({ error: 'No attachment uploaded.' });
    }

    const idx = parseInt(rfiIndex, 10);
    if (isNaN(idx) || idx < 0) {
        return res.status(400).json({ error: 'Invalid rfiIndex.' });
    }

    try {
        const extraction = await RfiExtraction.findOne({ _id: id, projectId, createdByAdminId: adminId });
        if (!extraction) return res.status(404).json({ error: 'RFI extraction not found.' });

        if (!extraction.rfis[idx]) {
            return res.status(404).json({ error: `RFI item at index ${idx} not found.` });
        }

        // store the OneDrive URL for the response attachment
        extraction.rfis[idx].responseAttachmentUrl = req.file.webUrl;
        extraction.rfis[idx].responseAttachmentName = req.file.originalname;
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

// Stream source PDF for RFI extraction (GridFS / Disk)
exports.viewRfiPdf = async (req, res) => {
    const { projectId, id } = req.params;
    const adminId = req.principal.adminId;
    console.log(`[DEBUG viewRfiPdf] Start. projectId=${projectId}, id=${id}, adminId=${adminId}`);

    try {
        const doc = await RfiExtraction.findOne({ _id: id, projectId, createdByAdminId: adminId });
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
                    const { stream, contentType, contentLength } = await storageGateway.getFileStream(doc.storageGatewayPath);
                    res.setHeader('Content-Type', contentType || 'application/pdf');
                    res.setHeader('Content-Disposition', 'inline; filename="' + doc.originalFileName + '"');
                    if (contentLength) res.setHeader('Content-Length', contentLength);
                    
                    stream.pipe(res);
                    return;
                }
            } catch (err) {
                console.error('[ViewRfiPdf] Storage Gateway stream failed:', err.message);
                return res.status(500).json({ error: 'Failed to stream file from Storage Gateway.' });
            }
        }

        // 1. OneDrive Mode
        if (doc.oneDriveFileId && !doc.oneDriveFileId.toLowerCase().endsWith('.pdf')) {
            console.log(`[DEBUG viewRfiPdf] Trying OneDrive.`);
            try {
                const rclone = require('../utils/rcloneOneDrive');
                
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', 'inline; filename="' + doc.originalFileName + '"');
                
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
                res.setHeader('Content-Disposition', 'inline; filename="' + doc.originalFileName + '"');

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
                res.setHeader('Content-Disposition', 'inline; filename="' + doc.originalFileName + '"');
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
