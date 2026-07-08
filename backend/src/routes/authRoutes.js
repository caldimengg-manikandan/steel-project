/**
 * Auth Routes
 * POST /api/auth/admin/login
 * POST /api/auth/user/login
 * GET  /api/auth/me
 */
const express = require('express');
const { adminLogin, userLogin, getMe, logout } = require('../controllers/authController');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

router.post('/admin/login', adminLogin);
router.post('/user/login', userLogin);
router.get('/me', verifyToken, getMe);
router.post('/logout', logout);

module.exports = router;
