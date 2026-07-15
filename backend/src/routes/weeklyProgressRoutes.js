const express = require('express');
const router = express.Router();
const weeklyProgressController = require('../controllers/weeklyProgressController');

// All routes here might need auth middleware, assuming they are imported where auth is applied 
// or we can just export the router. The main app.js usually handles authentication middleware.

router.get('/:projectId', weeklyProgressController.getReportsByProject);
router.get('/:projectId/:reportId', weeklyProgressController.getReportDraft);
router.post('/:projectId', weeklyProgressController.saveReportDraft);
router.get('/:projectId/:reportId/download', weeklyProgressController.downloadExcel);

module.exports = router;
