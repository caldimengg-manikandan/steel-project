const path = require('path');
const fs = require('fs');
const RfiExtraction = require('../models/RfiExtraction');
const { runRfiExtraction } = require('../services/rfiExtractionService');
const { generateRfiLogExcel } = require('../services/rfiExcelService');

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

    // Ensure upload directory exists
    const uploadDir = path.join(__dirname, '../../uploads/rfis');
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
    }

    // Process each file
    for (const file of req.files) {
        const doc = await RfiExtraction.create({
            projectId,
            createdByAdminId: adminId,
            uploadedBy,
            originalFileName: file.originalname,
            folderName: localSavePath || '',
            fileUrl: `/uploads/rfis/${projectId}/${file.filename}`,
            status: 'queued',
            sequences: sequences || [],
        });
        createdExtractions.push(doc);

        // process in background
        runRfiExtraction(doc._id);
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
            createdByAdminId: adminId,
            status: 'completed'
        };

        if (req.query.extractionId) {
            query._id = req.query.extractionId;
        }

        const extractions = await RfiExtraction.find(query).lean();

        if (extractions.length === 0) {
            return res.status(404).json({ error: 'No completed RFI extractions found.' });
        }

        const serverOrigin = `${req.protocol}://${req.get('host')}`;
        const queryBase = req.query.baseUrl || '';
        const baseUrl = queryBase || serverOrigin;
        const isExternal = !!queryBase;

        const { buffer, filename } = await generateRfiLogExcel(extractions, {}, baseUrl, isExternal);

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
    const { id } = req.params;
    const adminId = req.principal.adminId;

    try {
        const doc = await RfiExtraction.findOneAndDelete({ _id: id, createdByAdminId: adminId });
        if (!doc) return res.status(404).json({ error: 'RFI extraction not found.' });

        const p = path.join(__dirname, '../../', doc.fileUrl);
        if (fs.existsSync(p)) {
            fs.unlinkSync(p);
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

        // store the relative URL for the response attachment
        const relativeUrl = `/uploads/rfis/${projectId}/${req.file.filename}`;
        
        extraction.rfis[idx].responseAttachmentUrl = relativeUrl;
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
