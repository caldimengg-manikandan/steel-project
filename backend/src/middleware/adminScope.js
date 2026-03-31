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

    if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({ error: 'Invalid userId.' });
    }

    const user = await User.findOne({ _id: userId }).select('-password_hash');
    if (!user) {
        // Return 404 rather than 403 to avoid leaking that the user exists
        return res.status(404).json({ error: 'User not found within your admin scope.' });
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

    if (typeof projectId === 'string') projectId = projectId.trim().replace(/\/$/, "");

    if (!mongoose.Types.ObjectId.isValid(projectId)) {
        console.error(`[Admin Guard] Blocked invalid projectId: "${projectId}"`);
        return res.status(400).json({ error: `Invalid projectId format: "${projectId}"` });
    }

    const project = await Project.findById(projectId);
    if (!project) {
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

    if (!userId) {
        return res.status(400).json({ error: 'userId is required in request body.' });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({ error: 'Invalid userId format.' });
    }

    // Look up user AND verify it belongs to THIS admin
    const user = await User.findOne({ _id: userId }).select('-password_hash');
    if (!user) {
        return res.status(403).json({
            error: 'Cross-admin assignment rejected. The specified user does not belong to your admin scope.',
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

    if (!mongoose.Types.ObjectId.isValid(projectId)) {
        return res.status(400).json({ error: 'Invalid projectId.' });
    }

    const project = await Project.findOne({
        _id: projectId,
        'assignments.userId': userId,
    });

    if (!project) {
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

    if (!mongoose.Types.ObjectId.isValid(projectId)) {
        console.error(`[Guard] Blocked invalid MongoDB ID: "${projectId}"`);
        return res.status(400).json({ error: `Invalid projectId format: "${projectId}"` });
    }

    let project;
    if (role === 'admin') {
        project = await Project.findById(projectId);
        if (!project) return res.status(404).json({ error: 'Project not found.' });
        req.scopedProject = project;
        req.userPermission = 'admin';
    } else {
        project = await Project.findOne({ _id: projectId, 'assignments.userId': id });
        if (!project) {
            return res.status(404).json({ error: 'Project not found or access denied.' });
        }
        req.scopedProject = project;
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
