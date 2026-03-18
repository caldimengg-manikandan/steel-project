const express = require('express');
const router = express.Router({ mergeParams: true });
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { verifyToken } = require('../middleware/auth');
const { scopeProjectAccess, requirePermission } = require('../middleware/adminScope');

const {
    uploadRfiDrawing,
    listRfiExtractions,
    downloadRfiExcel,
    deleteRfiExtraction,
    updateRfiResponse,
    updateRfiStatus,
    uploadRfiResponseAttachment,
} = require('../controllers/rfiController');

// Multer storage for RFI
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, `../../uploads/rfis/${req.params.projectId}`);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
        cb(null, `${Date.now()}-${safeName}`);
    }
});

const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') cb(null, true);
        else cb(new Error('Only PDF allowed'), false);
    }
});

const uploadResponse = multer({
    storage,
    fileFilter: (req, file, cb) => {
        // More permissive for response attachments
        const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('File type not allowed'), false);
    }
});

// All routes here are scoped under /api/rfis/:projectId
router.use(verifyToken);
// Binds req.principal and ensures user belongs to this project
router.use(scopeProjectAccess);

// List all Rfi Extractions
router.get('/', listRfiExtractions);

// Upload and Extract (editor + admin)
router.post('/upload', requirePermission('editor'), upload.array('files', 50), uploadRfiDrawing);

// Download Excel report
router.get('/excel/download', downloadRfiExcel);

// Update response for a specific RFI item (editor + admin)
router.patch('/:id/response/:rfiIndex', requirePermission('editor'), updateRfiResponse);

// Update status (OPEN / CLOSED) for a specific RFI item (editor + admin)
router.patch('/:id/status/:rfiIndex', requirePermission('editor'), updateRfiStatus);

// Upload attachment for an RFI response (editor + admin)
router.post('/:id/response/:rfiIndex/attachment', requirePermission('editor'), uploadResponse.single('file'), uploadRfiResponseAttachment);

// Delete single Extraction (admin only)
router.delete('/:id', requirePermission('admin'), deleteRfiExtraction);

module.exports = router;
