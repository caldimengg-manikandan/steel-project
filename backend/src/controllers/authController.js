/**
 * ============================================================
 * Auth Controller
 * ============================================================
 * Handles login for BOTH admins and users.
 * Issues JWT with { id, username, email, role, adminId }.
 *
 * POST /api/auth/admin/login
 * POST /api/auth/user/login
 */
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const User = require('../models/User');

function signToken(payload) {
    return jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    });
}

/**
 * POST /api/auth/admin/login
 * Body: { username, password }
 */
async function adminLogin(req, res) {
    const { username, password } = req.body;
    console.log(`[AUTH] Admin login attempt for: "${username}"`);
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
    }

    const admin = await Admin.findOne({ username: username.trim().toLowerCase() })
        .select('+password_hash');

    if (!admin) {
        console.warn(`[AUTH] No admin found with username: ${username}`);
        return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const valid = await admin.matchPassword(password);
    if (!valid) {
        console.warn(`[AUTH] Invalid password for admin: ${username}`);
        return res.status(401).json({ error: 'Invalid username or password.' });
    }

    console.log(`[AUTH] Admin ${username} logged in successfully!`);
    const token = signToken({
        id: admin._id,
        username: admin.username,
        email: admin.email,
        role: 'admin',
        adminId: admin._id,
    });

    res.json({
        token,
        user: admin.toSafeObject(),
    });
}

/**
 * POST /api/auth/user/login
 * Body: { username, password }
 *
 * NOTE: Username alone may not be unique across admins.
 * If your firm has a single login page, you can add
 * an email/username field and match by email globally.
 */
async function userLogin(req, res) {
    const { username, password } = req.body;
    console.log(`[AUTH] User login attempt: ${username}`);

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required.' });
    }

    // Find user by username across ALL admins (email is unique per admin, not globally)
    // If you want global uniqueness, use email as the login identifier.
    const user = await User.findOne({ username: username.trim().toLowerCase() })
        .select('+password_hash');

    if (!user) {
        return res.status(401).json({ error: 'Invalid username or password.' });
    }

    if (user.status !== 'active') {
        return res.status(403).json({ error: 'Your account has been deactivated. Contact your administrator.' });
    }

    const valid = await user.matchPassword(password);
    if (!valid) {
        return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const token = signToken({
        id: user._id,
        username: user.username,
        email: user.email,
        role: 'user',
        adminId: user.adminId,   // carries admin scope into every request
    });

    res.json({
        token,
        user: user.toSafeObject(),
    });
}

/**
 * GET /api/auth/me
 * Returns the current principal's profile (relies on verifyToken).
 */
async function getMe(req, res) {
    res.json({ user: req.principal });
}

module.exports = { adminLogin, userLogin, getMe };
