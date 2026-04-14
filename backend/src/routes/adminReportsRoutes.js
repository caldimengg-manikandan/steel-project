const express = require('express');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { getReportsData } = require('../controllers/adminReportsController');

const router = express.Router();

router.use(verifyToken, requireAdmin);

router.get('/', getReportsData);

module.exports = router;
