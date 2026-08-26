/**
 * ============================================================
 * Middleware: Admin Scope Enforcement
 * ============================================================
 *
 * This is the CORE of multi-tenant isolation.
 *
 * Every resource (User, Project) has an adminId / createdByAdminId.
 * These middleware functions guarantee that:
 *   - Admin A can NEVER read or write Admin B's data
 *   - Not even if Admin A guesses Admin B's resource IDs
 *
 * CHAIN ORDER:
 *   verifyToken → requireAdmin → [scopeGuard middleware] → controller
 */
const mongoose = require('mongoose');
const User = require('../models/User');
const Project = require('../models/Project');
const { getExternalProjects } = require('../services/externalProjectService');

/**
 * scopeUserToAdmin
 * ─────────────────
 * Verifies that the User being accessed (req.params.userId)
 * belongs to the logged-in admin.
 *
 * Use on routes like:  GET /api/admin/users/:userId
 */
async function scopeUserToAdmin(req, res, next) {
    const { userId } = req.params;
    const adminId = req.principal.adminId;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({ error: 'Invalid userId.' });
    }

    const query = { _id: userId };
    if (req.principal.role !== 'superadmin') {
        query.adminId = adminId;
    }
    const user = await User.findOne(query).select('-password_hash');
    if (!user) {
        return res.status(404).json({ error: 'User not found.' });
    }

    req.scopedUser = user;   // attach for use in controller
    next();
}

/**
 * scopeProjectToAdmin
 * ─────────────────────
 * Verifies that the Project being accessed (req.params.projectId)
 * belongs to the logged-in admin.
 *
 * Use on routes like:  GET /api/admin/projects/:projectId
 */
async function scopeProjectToAdmin(req, res, next) {
    let { projectId } = req.params;
    const adminId = req.principal.adminId;

    if (typeof projectId === 'string') projectId = projectId.trim().replace(/\/$/, "");

    let project = null;
    if (mongoose.Types.ObjectId.isValid(projectId)) {
        const query = { _id: projectId };
        if (req.principal.role !== 'superadmin') {
            query.createdByAdminId = adminId;
        }
        project = await Project.findOne(query);
    }
    if (!project) {
        // Fallback: Check if it's an external project
        const externalResult = await getExternalProjects();
        const found = externalResult.projects.find(p => p.id === projectId);
        if (found) {
            if (req.method !== 'GET') {
                return res.status(403).json({ error: 'External projects are read-only.' });
            }
            req.scopedProject = found;
            return next();
        }
        return res.status(404).json({ error: 'Project not found.' });
    }

    req.scopedProject = project;
    next();
}

/**
 * validateCrossAdminAssignment
 * ─────────────────────────────
 * Validates that the userId being assigned to a project
 * BOTH:
 *   1. Belongs to the logged-in admin
 *   2. Would not create a cross-admin assignment
 *
 * Call this BEFORE saving an assignment.
 * Sets req.assignmentUser with the resolved User document.
 *
 * Usage:  POST /api/admin/projects/:projectId/assignments
 *   Body: { userId, permission }
 */
async function validateCrossAdminAssignment(req, res, next) {
    const { userId } = req.body;
    const adminId = req.principal.adminId;

    if (!userId) {
        return res.status(400).json({ error: 'userId is required in request body.' });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({ error: 'Invalid userId format.' });
    }

    const query = { _id: userId };
    if (req.principal.role !== 'superadmin') {
        query.adminId = adminId;
    }
    const user = await User.findOne(query).select('-password_hash');
    if (!user) {
        return res.status(403).json({
            error: 'Specified user does not exist.',
        });
    }

    if (user.status !== 'active') {
        return res.status(400).json({ error: 'Cannot assign an inactive user to a project.' });
    }

    req.assignmentUser = user;
    next();
}

/**
 * scopeProjectToUser
 * ────────────────────
 * For USER-role routes: verifies the project exists AND
 * the current user is listed in its assignments.
 *
 * Use on routes like:  GET /api/user/projects/:projectId
 */
async function scopeProjectToUser(req, res, next) {
    const { projectId } = req.params;
    const userId = req.principal.id;

    let project = null;
    if (mongoose.Types.ObjectId.isValid(projectId)) {
        project = await Project.findOne({
            _id: projectId,
            'assignments.userId': userId,
        });
    }

    if (!project) {
        // Users cannot access external projects
        const externalResult = await getExternalProjects();
        const found = externalResult.projects.find(p => p.id === projectId);
        if (found) {
            return res.status(403).json({ error: 'External projects are not accessible to users.' });
        }
        return res.status(404).json({ error: 'Project not found or you are not assigned to it.' });
    }

    req.scopedProject = project;
    req.userPermission = project.assignments.find(
        (a) => a.userId.toString() === userId
    )?.permission ?? 'viewer';

    next();
}

/**
 * scopeProjectAccess
 * ───────────────────
 * UNIFIED scope check for BOTH admins and users.
 * - If principal is admin: checks if they created the project.
 * - If principal is user: checks if they are assigned to the project.
 * Sets: req.scopedProject and req.userPermission.
 */
async function scopeProjectAccess(req, res, next) {
    const { id, role, adminId } = req.principal;

    // Capture projectId from any possible source (Params, Body, or Query)
    let projectId = req.params.projectId || req.body.projectId || req.query.projectId;

    // DEBUG (Step 5): Log request details
    console.log(`[Guard] scopeProjectAccess: ${req.method} ${req.originalUrl}`);
    console.log(`[Guard] Detected projectId:`, projectId, `(Type: ${typeof projectId})`);

    // Standardize and validate projectId
    if (typeof projectId === 'string') {
        projectId = projectId.trim().replace(/\/$/, "");
    } else if (projectId && typeof projectId.toString === 'function') {
        projectId = projectId.toString();
    }

    if (!projectId || typeof projectId !== 'string') {
        console.error(`[Guard] Blocked invalid projectId type:`, typeof projectId, "for URL:", req.originalUrl);
        return res.status(400).json({
            error: 'Invalid projectId format (expecting string).',
            receivedType: typeof projectId,
            hint: 'Ensure your frontend sends the project ID in the URL structure.'
        });
    }

    const FULL_ACCESS_ROLES = ['admin', 'superadmin', 'project_manager', 'team_lead', 'pm', 'tl'];
    const isFullAccess = FULL_ACCESS_ROLES.includes(role);

    let project = null;
    if (isFullAccess && mongoose.Types.ObjectId.isValid(projectId)) {
        project = await Project.findById(projectId);
    } else if (mongoose.Types.ObjectId.isValid(projectId)) {
        project = await Project.findOne({ _id: projectId, 'assignments.userId': id });
    }

    if (!project) {
        // Fallback: Check if it's an external project
        const externalResult = await getExternalProjects();
        const found = externalResult.projects.find(p => p.id === projectId);
        if (found) {
            if (req.method !== 'GET') {
                return res.status(403).json({ error: 'External projects are read-only.' });
            }
            req.scopedProject = found;
            req.userPermission = 'viewer';
            return next();
        }
        return res.status(404).json({ error: 'Project not found or access denied.' });
    }

    req.scopedProject = project;
    if (isFullAccess) {
        req.userPermission = 'admin';
    } else {
        req.userPermission = project.assignments.find(a => a.userId.toString() === id)?.permission || 'viewer';
    }

    next();
}

/**
 * requirePermission
 * ─────────────────
 * Role-based access control. Must be chained AFTER scopeProjectAccess.
 * minLevel: 'viewer' | 'editor' | 'admin'
 */
function requirePermission(minLevel) {
    const levels = { viewer: 0, editor: 1, admin: 2 };
    return (req, res, next) => {
        const current = levels[req.userPermission] ?? 0;
        const required = levels[minLevel] ?? 0;
        if (current < required) {
            return res.status(403).json({ error: `Insufficient project permissions. '${minLevel}' level or higher required.` });
        }
        next();
    };
}

module.exports = {
    scopeUserToAdmin,
    scopeProjectToAdmin,
    validateCrossAdminAssignment,
    scopeProjectToUser,
    scopeProjectAccess,
    requirePermission,
};
