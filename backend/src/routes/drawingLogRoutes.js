const express = require('express');
const router = express.Router();
const { verifyToken, requireAdmin } = require('../middleware/auth');
const drawingLogController = require('../controllers/drawingLogController');

router.use(verifyToken);

// Fetch all projects that have extractions
router.get('/projects', requireAdmin, drawingLogController.getProjectsWithDrawings);

// Fetch drawing log for a project
router.get('/:projectId', requireAdmin, drawingLogController.getDrawingLog);

// Download drawing log as excel
router.get('/:projectId/download', requireAdmin, drawingLogController.downloadDrawingLogExcel);

module.exports = router;
