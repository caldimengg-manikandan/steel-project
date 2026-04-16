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
const { storage } = require('../utils/onedrive');

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
    limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
});

// ── Apply unified scope to all extraction routes ──────────
router.use(verifyToken, scopeProjectAccess);

// ── Routes ────────────────────────────────────────────────

// Pre-flight duplicate check (Requires Viewer+)
router.post('/check-duplicates', requirePermission('viewer'), ctrl.checkDuplicates);

// Upload + trigger extraction (Requires Editor or Admin)
router.post(
    '/upload',
    requirePermission('editor'),
    upload.array('drawings'),
    (err, req, res, next) => {
        // Multer error handler
        if (err) return res.status(400).json({ error: err.message });
        next();
    },
    ctrl.uploadAndExtract
);

// List all extractions for a project (Requires Viewer)
router.get('/', requirePermission('viewer'), ctrl.listExtractions);

// ── Download Excel ────────────────────────────────────────
router.get('/excel/download', requirePermission('viewer'), ctrl.downloadExcel);

// View PDF stream (Requires Viewer)
router.get('/:id/view', requirePermission('viewer'), ctrl.viewPdf);

// Get a single extraction (Requires Viewer)
router.get('/:id', requirePermission('viewer'), ctrl.getExtraction);

// Reprocess a failed extraction (Requires Editor)
router.post('/:id/reprocess', requirePermission('editor'), ctrl.reprocess);

// Delete an extraction (Requires Admin only)
router.delete('/:id', requirePermission('admin'), ctrl.deleteExtraction);

module.exports = router;

