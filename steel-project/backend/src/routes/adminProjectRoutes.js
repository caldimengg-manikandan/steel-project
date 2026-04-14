/**
 * Admin Project Management Routes
 * All routes protected by: verifyToken → requireAdmin → [scope middleware]
 *
 * GET    /api/admin/projects
 * POST   /api/admin/projects
 * GET    /api/admin/projects/status/excel   ← NEW: download all-project status report
 * GET    /api/admin/projects/:projectId
 * PATCH  /api/admin/projects/:projectId
 * DELETE /api/admin/projects/:projectId
 * POST   /api/admin/projects/:projectId/assignments
 * DELETE /api/admin/projects/:projectId/assignments/:userId
 */
const express = require('express');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const { scopeProjectToAdmin, validateCrossAdminAssignment } = require('../middleware/adminScope');
const {
    listProjects, createProject, getProject,
    updateProject, deleteProject, assignUser, removeAssignment,
    downloadAllProjectsStatusExcel, uploadCOR,
    reserveTransmittalNumber,
} = require('../controllers/adminProjectsController');
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

router.use(verifyToken, requireAdmin);

// ── Project Status Excel (Must be before /:projectId to avoid route collision) ──
router.get('/status/excel', downloadAllProjectsStatusExcel);

// Project CRUD
router.get('/', listProjects);
router.post('/', createProject);

// Project Operations
router.post('/:projectId/reserve-transmittal', scopeProjectToAdmin, reserveTransmittalNumber);
router.post('/:projectId/cor', scopeProjectToAdmin, upload.single('file'), uploadCOR);
router.post('/:projectId/assignments', scopeProjectToAdmin, validateCrossAdminAssignment, assignUser);
router.delete('/:projectId/assignments/:userId', scopeProjectToAdmin, removeAssignment);

// Project CRUD
router.get('/:projectId', scopeProjectToAdmin, getProject);
router.patch('/:projectId', scopeProjectToAdmin, updateProject);
router.delete('/:projectId', scopeProjectToAdmin, deleteProject);

module.exports = router;

