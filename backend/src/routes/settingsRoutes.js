const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settingsController');
const { verifyToken, requireAdmin: isAdmin } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configure Multer for Logo Upload
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, '../../uploads/system');
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `company_logo${ext}`); // We can keep it simple and overwrite or use timestamp
    }
});

const upload = multer({ 
    storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif/;
        const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mime = allowedTypes.test(file.mimetype);
        if (ext && mime) return cb(null, true);
        cb(new Error('Only images are allowed (jpeg, jpg, png, gif)'));
    }
});

router.get('/', verifyToken, settingsController.getSettings);
router.patch('/', verifyToken, isAdmin, settingsController.updateSettings);
router.post('/logo', verifyToken, isAdmin, upload.single('logo'), settingsController.uploadLogo);
router.patch('/email', verifyToken, isAdmin, settingsController.updateEmailSettings);
router.post('/email/test', verifyToken, isAdmin, settingsController.testEmailSettings);

module.exports = router;
