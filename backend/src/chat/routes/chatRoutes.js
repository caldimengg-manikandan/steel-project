/**
 * ============================================================
 * Chat Module: Express Routes
 * ============================================================
 */
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { verifyToken } = require('../../middleware/auth');
const chatController = require('../controllers/chatController');

const router = express.Router();

// Ensure upload directory exists
const chatUploadDir = path.join(__dirname, '../../../uploads/chat');
if (!fs.existsSync(chatUploadDir)) {
    fs.mkdirSync(chatUploadDir, { recursive: true });
}

// Multer Storage Configuration
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, chatUploadDir);
    },
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname);
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        cb(null, `chat-${uniqueSuffix}${ext}`);
    },
});

const BLOCKED_EXTENSIONS = ['.exe', '.bat', '.cmd', '.sh', '.vbs', '.msi', '.com', '.scr', '.pif', '.ps1'];

const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
    fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (BLOCKED_EXTENSIONS.includes(ext)) {
            return cb(new Error('Executable and script files are not allowed for security reasons.'));
        }
        cb(null, true);
    },
});

// Protect all chat endpoints with standard authentication
router.use(verifyToken);

// Realtime socket token helper
const jwt = require('jsonwebtoken');
router.get('/token', (req, res) => {
    const token = jwt.sign(
        {
            id: req.principal.id,
            username: req.principal.username,
            email: req.principal.email,
            role: req.principal.role,
            adminId: req.principal.adminId,
        },
        process.env.JWT_SECRET,
        { expiresIn: '8h' }
    );
    res.json({ success: true, token });
});

// Conversation management
router.get('/conversations', chatController.listConversations);
router.post('/conversations', chatController.createConversation);

// Messages in a conversation
router.get('/conversations/:id/messages', chatController.getMessages);
router.post('/conversations/:id/messages', chatController.sendMessage);
router.delete('/conversations/:id/messages/:messageId', chatController.deleteMessage);
router.patch('/conversations/:id/read', chatController.markAsRead);

// User search for new chats
router.get('/users', chatController.searchUsers);

// File uploads
router.post('/upload', upload.single('file'), chatController.uploadAttachment);

module.exports = router;
