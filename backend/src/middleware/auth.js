/**
 * ============================================================
 * Middleware: JWT Authentication
 * ============================================================
 * Verifies the Bearer token and attaches req.principal:
 *   { id, username, email, role }
 *
 * Works for BOTH admins and users.
 * Role-specific logic is handled by downstream middleware.
 */
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const User = require('../models/User');

// roles with full system access
const FULL_ACCESS_ROLES = ['admin', 'superadmin', 'project_manager', 'team_lead'];

/**
 * verifyToken
 * Reads Authorization: Bearer <token>, validates it,
 * then loads the real document from the DB to confirm
 * the account still exists and is active.
 */
async function verifyToken(req, res, next) {
    // 1. Extract token (Support Header, Cookie, or Query)
    const header = req.headers['authorization'] || '';
    let token = req.cookies?.sdms_token || req.query.token || '';

    if (!token && header.startsWith('Bearer ')) {
        token = header.slice(7);
    }

    if (!token) {
        return res.status(401).json({ error: 'No token provided.' });
    }

    // 2. Verify signature + expiry
    let decoded;
    try {
        decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
        const msg = err.name === 'TokenExpiredError'
            ? 'Token has expired. Please log in again.'
            : 'Invalid token.';
        return res.status(401).json({ error: msg });
    }

    // 3. Load the account from DB to confirm it still exists
    try {
        if (decoded.role === 'admin') {
            const admin = await Admin.findById(decoded.id).select('-password_hash');
            if (!admin || admin.status !== 'active') {
                return res.status(401).json({ error: 'Admin account not found or deactivated.' });
            }
            req.principal = {
                id: admin._id.toString(),
                username: admin.username,
                email: admin.email,
                role: 'admin',
                adminId: admin._id.toString(),   // for admin: adminId === their own id
            };
        } else {
            const user = await User.findById(decoded.id).select('-password_hash');
            if (!user || user.status !== 'active') {
                return res.status(401).json({ error: 'User account not found or deactivated.' });
            }
            req.principal = {
                id: user._id.toString(),
                username: user.username,
                email: user.email,
                role: user.role || 'user',
                adminId: user.adminId ? user.adminId.toString() : user._id.toString(),  // for user: adminId = their admin's id or own id
            };
        }
        next();
    } catch (err) {
        next(err);
    }
}

/**
 * requireAdmin
 * Must be chained AFTER verifyToken.
 * Rejects any principal without full system access.
 */
function requireAdmin(req, res, next) {
    if (!FULL_ACCESS_ROLES.includes(req.principal?.role)) {
        return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
}

/**
 * requireUser
 * Must be chained AFTER verifyToken.
 * Rejects any principal not logged in as a 'User' entity.
 */
function requireUser(req, res, next) {
    // Only 'admin' model logins don't pass this check as 'User' logins.
    if (req.principal?.role === 'admin') {
        return res.status(403).json({ error: 'User access required.' });
    }
    next();
}

module.exports = { verifyToken, requireAdmin, requireUser, FULL_ACCESS_ROLES };
