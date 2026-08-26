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
    viewRfiPdf,
} = require('../controllers/rfiController');

const uploadDir = path.join(__dirname, '../../uploads/steel-dms-uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const diskStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'rfi-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: diskStorage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') cb(null, true);
        else cb(new Error('Only PDF allowed'), false);
    },
    limits: {
        fileSize: 50 * 1024 * 1024, // 50 MB
        files: 50
    }
});

const uploadResponse = multer({
    storage: diskStorage,
    fileFilter: (req, file, cb) => {
        const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('File type not allowed'), false);
    },
    limits: {
        fileSize: 20 * 1024 * 1024, // 20 MB
        files: 10
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

// Stream PDF for viewing (supports both /view and /view.pdf for compatibility with existing Excel files)
router.get('/:id/view.pdf', viewRfiPdf);
router.get('/:id/view', viewRfiPdf);

// Delete single Extraction (editor + admin)
router.delete('/:id', requirePermission('editor'), deleteRfiExtraction);


module.exports = router;
