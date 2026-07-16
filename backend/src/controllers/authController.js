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
const { logActivity } = require('../utils/logger');

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
    try {
        const { username, password } = req.body;
        console.log(`[AUTH] Admin login attempt for: "${username}"`);
        
        if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
            return res.status(400).json({ error: 'Username and password are required and must be strings.' });
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

        if (!process.env.JWT_SECRET) {
            throw new Error('JWT_SECRET is not defined in environment variables');
        }

        console.log(`[AUTH] Admin ${username} logged in successfully!`);
        const token = signToken({
            id: admin._id.toString(),
            username: admin.username,
            email: admin.email,
            role: 'admin',
            adminId: admin._id.toString(),
        });

        res.cookie('sdms_token', token, {
            httpOnly: true,
            secure: true,
            sameSite: 'none',
            maxAge: 8 * 60 * 60 * 1000
        });
        
        await logActivity(admin.username, 'Auth', 'Admin logged in');
        
        res.json({ 
            user: admin.toSafeObject(),
            token: token // Return token explicitly
        });
    } catch (err) {
        console.error('[AUTH_ERROR] adminLogin failed:', err);
        throw err; // Passed to errorHandler
    }
}

/**
 * POST /api/auth/user/login
 * Body: { username, password }
 */
async function userLogin(req, res) {
    try {
        const { username, password } = req.body;
        console.log(`[AUTH] User login attempt: ${username}`);

        if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
            return res.status(400).json({ error: 'Username and password are required and must be strings.' });
        }

        // Find user by username across ALL admins
        const user = await User.findOne({ username: username.trim().toLowerCase() })
            .select('+password_hash');

        if (!user) {
            console.warn(`[AUTH] No user found with username: ${username}`);
            return res.status(401).json({ error: 'Invalid username or password.' });
        }

        if (user.status !== 'active') {
            return res.status(403).json({ error: 'Your account has been deactivated. Contact your administrator.' });
        }

        const valid = await user.matchPassword(password);
        if (!valid) {
            console.warn(`[AUTH] Invalid password for user: ${username}`);
            return res.status(401).json({ error: 'Invalid username or password.' });
        }

        if (!process.env.JWT_SECRET) {
            throw new Error('JWT_SECRET is not defined in environment variables');
        }

        const token = signToken({
            id: user._id.toString(),
            username: user.username,
            email: user.email,
            role: 'user',
            adminId: user.adminId.toString(),
        });

        res.cookie('sdms_token', token, {
            httpOnly: true,
            secure: true,
            sameSite: 'none',
            maxAge: 8 * 60 * 60 * 1000
        });
        
        await logActivity(user.username, 'Auth', 'User logged in');
        res.json({ 
            user: user.toSafeObject(),
            token: token // Return token explicitly
        });
    } catch (err) {
        console.error('[AUTH_ERROR] userLogin failed:', err);
        throw err; // Passed to errorHandler
    }
}

/**
 * GET /api/auth/me
 * Returns the current principal's profile (relies on verifyToken).
 */
async function getMe(req, res) {
    res.json({ user: req.principal });
}

/**
 * POST /api/auth/logout
 * Clears the sdms_token cookie.
 */
async function logout(req, res) {
    let username = 'Unknown';
    try {
        const token = req.cookies?.sdms_token;
        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
            username = decoded.username;
        }
    } catch(e) {}
    
    await logActivity(username, 'Auth', 'Logged out');
    
    res.clearCookie('sdms_token');
    res.json({ message: 'Logged out successfully' });
}

module.exports = { adminLogin, userLogin, getMe, logout };
