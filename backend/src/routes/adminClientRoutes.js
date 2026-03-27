const express = require('express');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { 
    listClients, 
    createClient,
    updateClient,
    deleteClient,
    bulkCreateClients
} = require('../controllers/adminClientsController');
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

// Apply auth middleware to ALL routes here
router.use(verifyToken, requireAdmin);

router.get('/', listClients);
router.post('/', createClient);
router.post('/bulk', upload.single('file'), bulkCreateClients);
router.patch('/:clientId', updateClient);
router.delete('/:clientId', deleteClient);

module.exports = router;
