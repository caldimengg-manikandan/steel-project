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
router.use(verifyToken);

// ── Routes ────────────────────────────────────────────────

// Preview what would be in the next transmittal (dry-run, no side effects)
router.post('/preview-changes', scopeProjectAccess, requirePermission('viewer'), ctrl.previewChanges);

// Generate a new transmittal + incrementally update Drawing Log
router.post('/generate', scopeProjectAccess, requirePermission('editor'), ctrl.generateTransmittal);

// List all transmittals for a project (newest first)
router.get('/', scopeProjectAccess, requirePermission('viewer'), ctrl.listTransmittals);

// ── Drawing Log routes ──────────────────────────────────────

// Get the Drawing Log (JSON)
router.get('/drawing-log', scopeProjectAccess, requirePermission('viewer'), ctrl.getDrawingLog);

// Download Drawing Log as Excel
router.get('/drawing-log/excel', scopeProjectAccess, requirePermission('viewer'), ctrl.downloadDrawingLogExcel);

// ── Single Transmittal routes ─────────────────────────────

// Download a specific transmittal as Excel
router.get('/:transmittalId/excel', scopeProjectAccess, requirePermission('viewer'), ctrl.downloadTransmittalExcel);

// Get a single transmittal by ID
router.get('/:transmittalId', scopeProjectAccess, requirePermission('viewer'), ctrl.getTransmittal);

// Delete a transmittal (admin only)
router.delete('/:transmittalId', scopeProjectAccess, requirePermission('admin'), ctrl.deleteTransmittal);

module.exports = router;
