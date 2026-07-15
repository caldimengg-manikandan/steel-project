const express = require('express');
const router = express.Router();
const errorLogController = require('../controllers/errorLogController');

router.get('/', errorLogController.getErrorLogs);
router.post('/', errorLogController.saveErrorLogs);
router.get('/download', errorLogController.downloadExcel);

module.exports = router;
