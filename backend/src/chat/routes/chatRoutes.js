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

const ALLOWED_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
];

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
    fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Unsupported file type. Allowed: images, PDF, Word, Excel, text files.'));
        }
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
router.patch('/conversations/:id/read', chatController.markAsRead);

// User search for new chats
router.get('/users', chatController.searchUsers);

// File uploads
router.post('/upload', upload.single('file'), chatController.uploadAttachment);

module.exports = router;
