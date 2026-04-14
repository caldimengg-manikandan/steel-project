const express = require('express');
const { verifyToken } = require('../middleware/auth');
const { getNotifications, markAllRead } = require('../controllers/notificationController');

const router = express.Router();

router.use(verifyToken);

router.get('/', getNotifications);
router.patch('/mark-read', markAllRead);

module.exports = router;
