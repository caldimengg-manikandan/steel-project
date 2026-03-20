/**
 * ============================================================
 * Transmittal Routes
 * ============================================================
 *
 * All routes:
 *   - Require JWT authentication (verifyToken)
 *   - Require admin scope enforcement (scopeProjectAccess)
 *   - Require appropriate permission level per operation
 *
 * Base: /api/transmittals/:projectId
 */
const express = require('express');
const router = express.Router({ mergeParams: true }); // mergeParams for projectId

const { verifyToken } = require('../middleware/auth');
const { scopeProjectAccess, requirePermission } = require('../middleware/adminScope');
const ctrl = require('../controllers/transmittalController');

// ── Apply unified scope to all transmittal routes ─────────
router.use(verifyToken, scopeProjectAccess);

// ── Routes ────────────────────────────────────────────────

// Preview what would be in the next transmittal (dry-run, no side effects)
// Must be BEFORE /:transmittalId routes to avoid conflict
router.post('/preview-changes', requirePermission('viewer'), ctrl.previewChanges);

// Generate a new transmittal + incrementally update Drawing Log
router.post('/generate', requirePermission('editor'), ctrl.generateTransmittal);

// List all transmittals for a project (newest first)
router.get('/', requirePermission('viewer'), ctrl.listTransmittals);

// ── Drawing Log routes ──────────────────────────────────────
// Must be before /:transmittalId to avoid "drawing-log" being treated as an ID

// Get the Drawing Log (JSON)
router.get('/drawing-log', requirePermission('viewer'), ctrl.getDrawingLog);

// Download Drawing Log as Excel
router.get('/drawing-log/excel', requirePermission('viewer'), ctrl.downloadDrawingLogExcel);

// ── Single Transmittal routes ─────────────────────────────

// Download a specific transmittal as Excel
router.get('/:transmittalId/excel', requirePermission('viewer'), ctrl.downloadTransmittalExcel);

// Get a single transmittal by ID
router.get('/:transmittalId', requirePermission('viewer'), ctrl.getTransmittal);

// Delete a transmittal (admin only)
router.delete('/:transmittalId', requirePermission('admin'), ctrl.deleteTransmittal);

module.exports = router;
