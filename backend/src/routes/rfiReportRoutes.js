const express = require('express');
const router = express.Router();
const rfiReportController = require('../controllers/rfiReportController');
router.get('/:projectId', rfiReportController.getRfiReports);
router.get('/:projectId/draft/:reportId', rfiReportController.getReportDraft);
router.post('/:projectId/draft', rfiReportController.saveReportDraft);
router.post('/:projectId/submit/:reportId', rfiReportController.submitReport);
router.delete('/:reportId', rfiReportController.deleteReport);

router.get('/:projectId/download/:reportId', rfiReportController.downloadExcel);

module.exports = router;
