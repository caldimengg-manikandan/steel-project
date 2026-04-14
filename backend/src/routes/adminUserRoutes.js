/**
 * Admin User Management Routes
 * All routes protected by: verifyToken → requireAdmin → [scope middleware]
 *
 * GET    /api/admin/users
 * POST   /api/admin/users
 * GET    /api/admin/users/:userId
 * PATCH  /api/admin/users/:userId
 * DELETE /api/admin/users/:userId
 */
const express = require('express');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { scopeUserToAdmin } = require('../middleware/adminScope');
const {
    listUsers, createUser, getUser, updateUser, deleteUser, bulkCreateUsers,
} = require('../controllers/adminUsersController');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, '../../uploads/temp');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, `${Date.now()}-${file.originalname}`);
    }
});
const upload = multer({ storage });

const router = express.Router();

// Apply auth to all routes in this file
router.use(verifyToken, requireAdmin);

router.get('/', listUsers);
router.post('/', createUser);
router.post('/bulk', upload.single('file'), bulkCreateUsers);
router.get('/:userId', scopeUserToAdmin, getUser);
router.patch('/:userId', scopeUserToAdmin, updateUser);
router.delete('/:userId', scopeUserToAdmin, deleteUser);

module.exports = router;
