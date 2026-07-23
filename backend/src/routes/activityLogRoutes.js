const express = require('express');
const router = express.Router();
const activityLogController = require('../controllers/activityLogController');
const { verifyToken, requireAdmin: isAdmin } = require('../middleware/auth');

router.get('/', verifyToken, isAdmin, activityLogController.getLogs);

module.exports = router;
