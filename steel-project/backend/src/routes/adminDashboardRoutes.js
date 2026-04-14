const express = require('express');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { getAdminStats } = require('../controllers/adminDashboardController');

const router = express.Router();

router.use(verifyToken, requireAdmin);

router.get('/stats', getAdminStats);

module.exports = router;
