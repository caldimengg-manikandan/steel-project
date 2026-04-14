/**
 * User Project Routes
 * All routes protected by: verifyToken → requireUser → [scope middleware]
 *
 * GET /api/user/projects
 * GET /api/user/projects/:projectId
 * GET /api/user/projects/:projectId/drawings
 */
const express = require('express');
const { verifyToken, requireUser } = require('../middleware/auth');
const {
    listMyProjects, getMyProject, getProjectDrawings, updateProjectSequences,
} = require('../controllers/userProjectsController');
const { scopeProjectToUser, scopeProjectAccess, requirePermission } = require('../middleware/adminScope');

const router = express.Router();

router.use(verifyToken, requireUser);

router.get('/', listMyProjects);
router.get('/:projectId', scopeProjectToUser, getMyProject);
router.patch('/:projectId/sequences', scopeProjectAccess, requirePermission('editor'), updateProjectSequences);
router.get('/:projectId/drawings', scopeProjectToUser, getProjectDrawings);

module.exports = router;
