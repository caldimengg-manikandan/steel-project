/**
 * Auth Routes
 * POST /api/auth/admin/login
 * POST /api/auth/user/login
 * GET  /api/auth/me
 * PATCH /api/auth/change-password  (any authenticated principal)
 */
const express = require('express');
const { adminLogin, userLogin, getMe, logout, changePassword } = require('../controllers/authController');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

router.post('/admin/login', adminLogin);
router.post('/user/login', userLogin);
router.get('/me', verifyToken, getMe);
router.post('/logout', logout);
router.patch('/change-password', verifyToken, changePassword);

module.exports = router;
