/**
 * ============================================================
 * Extraction Routes
 * ============================================================
 * All routes require:
 *   1. JWT authentication (verifyToken)
 *   2. Admin role (requireAdmin)
 *   3. Admin scope enforcement (scopeToAdmin)
 *
 * Multer handles multipart/form-data PDF uploads.
 * Files are stored in uploads/drawings/<projectId>/
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router({ mergeParams: true }); 

const { verifyToken } = require('../middleware/auth');
const { scopeProjectAccess, requirePermission } = require('../middleware/adminScope');
const ctrl = require('../controllers/extractionController');
const { storage } = require('../utils/gridfs');

const fileFilter = (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
        cb(null, true);
    } else {
        cb(new Error('Only PDF files are accepted.'), false);
    }
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

// ── Apply unified scope to all extraction routes ──────────
router.use(verifyToken);

// ── Routes ────────────────────────────────────────────────

router.post('/check-duplicates', scopeProjectAccess, requirePermission('viewer'), ctrl.checkDuplicates);

// Upload + trigger extraction (Requires Editor or Admin)
router.post(
    '/upload',
    scopeProjectAccess,
    requirePermission('editor'),
    upload.array('drawings'),
    (err, req, res, next) => {
        // Multer error handler
        if (err) return res.status(400).json({ error: err.message });
        next();
    },
    ctrl.uploadAndExtract
);

router.get('/', scopeProjectAccess, requirePermission('viewer'), ctrl.listExtractions);

// ── Download Excel ────────────────────────────────────────
router.get('/excel/download', scopeProjectAccess, requirePermission('viewer'), ctrl.downloadExcel);

// View PDF stream (Requires Viewer)
router.get('/:id/view', scopeProjectAccess, requirePermission('viewer'), ctrl.viewPdf);

// Get a single extraction (Requires Viewer)
router.get('/:id', scopeProjectAccess, requirePermission('viewer'), ctrl.getExtraction);

// Reprocess a failed extraction (Requires Editor)
router.post('/:id/reprocess', scopeProjectAccess, requirePermission('editor'), ctrl.reprocess);

// Delete an extraction (Requires Admin only)
router.delete('/:id', scopeProjectAccess, requirePermission('admin'), ctrl.deleteExtraction);

module.exports = router;

