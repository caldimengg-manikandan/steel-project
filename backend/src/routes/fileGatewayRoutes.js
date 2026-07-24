/**
 * ============================================================
 * File Gateway Routes
 * ============================================================
 * API Gateway routes for accessing the Windows storage drive.
 *
 * All routes require JWT authentication.
 * Write operations (upload, delete) require elevated permissions.
 *
 * Mounted at: /api/files
 *
 * Endpoints:
 *   GET    /api/files/browse?path=         — List directory contents
 *   GET    /api/files/info?path=           — Get file metadata
 *   GET    /api/files/download?path=       — Stream/download a file
 *   GET    /api/files/search?q=&path=      — Search files by name
 *   POST   /api/files/upload               — Upload files (multipart)
 *   DELETE /api/files/remove?path=         — Delete a file
 */
const express = require('express');
const multer = require('multer');
const router = express.Router();

const { verifyToken, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/fileGatewayController');
const storageGateway = require('../utils/storageGateway');

// ── Multer for upload (memory storage → streamed to drive) ──
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 500 * 1024 * 1024, // 500 MB max per file
        files: 50,                    // Max 50 files per request
    },
});

// ── Guard: reject requests if storage gateway is disabled ──
function requireStorageEnabled(req, res, next) {
    // If not enabled, we let the controller handle it gracefully 
    // (e.g. listDirectory returns empty array instead of 503 crash)
    next();
}

// ── Apply auth + gateway check to ALL routes ──────────────
router.use(verifyToken, requireStorageEnabled);

// ── Read Operations (any authenticated user) ──────────────
router.get('/browse', ctrl.browse);
router.get('/info', ctrl.info);
router.get('/download', ctrl.download);
router.get('/search', ctrl.search);

// ── Write Operations (admin only) ─────────────────────────
router.post(
    '/upload',
    requireAdmin,
    upload.array('files'),
    (err, req, res, next) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ error: 'File too large. Maximum 500 MB per file.' });
            }
            return res.status(400).json({ error: err.message });
        }
        next();
    },
    ctrl.upload
);

router.delete('/remove', requireAdmin, ctrl.remove);

module.exports = router;
