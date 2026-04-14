/**
 * Auth Routes
 * POST /api/auth/admin/login
 * POST /api/auth/user/login
 * GET  /api/auth/me
 */
const express = require('express');
const { adminLogin, userLogin, getMe } = require('../controllers/authController');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

router.post('/admin/login', adminLogin);
router.post('/user/login', userLogin);
router.get('/me', verifyToken, getMe);

module.exports = router;
