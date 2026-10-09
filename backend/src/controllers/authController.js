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
const bcrypt = require('bcryptjs');
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
 * Body: { employeeId, password }
 */
async function userLogin(req, res) {
    try {
        const { employeeId, password } = req.body;
        console.log(`[AUTH] User login attempt: ${employeeId}`);

        if (!employeeId || !password || typeof employeeId !== 'string' || typeof password !== 'string') {
            return res.status(400).json({ error: 'Employee ID and password are required and must be strings.' });
        }

        // Find user by employeeId across ALL admins
        const user = await User.findOne({ employeeId: employeeId.trim() })
            .select('+password_hash');

        if (!user) {
            console.warn(`[AUTH] No user found with employeeId: ${employeeId}`);
            return res.status(401).json({ error: 'Invalid Employee ID or password.' });
        }

        if (user.status !== 'active') {
            return res.status(403).json({ error: 'Your account has been deactivated. Contact your administrator.' });
        }

        const valid = await user.matchPassword(password);
        if (!valid) {
            console.warn(`[AUTH] Invalid password for user: ${employeeId}`);
            return res.status(401).json({ error: 'Invalid Employee ID or password.' });
        }

        if (!process.env.JWT_SECRET) {
            throw new Error('JWT_SECRET is not defined in environment variables');
        }

        const token = signToken({
            id: user._id.toString(),
            username: user.username,
            email: user.email,
            role: user.role,
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
    
    res.clearCookie('sdms_token', {
        httpOnly: true,
        secure: true,
        sameSite: 'none'
    });
    res.json({ message: 'Logged out successfully' });
}

/**
 * PATCH /api/auth/change-password
 * Body: { currentPassword, newPassword }
 * Works for BOTH admins (role=admin) and regular users.
 */
async function changePassword(req, res) {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Current password and new password are required.' });
        }
        if (typeof newPassword !== 'string' || newPassword.length < 6) {
            return res.status(400).json({ error: 'New password must be at least 6 characters.' });
        }
        if (currentPassword === newPassword) {
            return res.status(400).json({ error: 'New password must be different from the current password.' });
        }

        const principal = req.principal;
        let account;

        if (principal.role === 'admin') {
            account = await Admin.findById(principal.id).select('+password_hash');
        } else {
            account = await User.findById(principal.id).select('+password_hash');
        }

        if (!account) {
            return res.status(404).json({ error: 'Account not found.' });
        }

        const valid = await account.matchPassword(currentPassword);
        if (!valid) {
            return res.status(401).json({ error: 'Current password is incorrect.' });
        }

        // Set new password — the pre-save hook will hash it
        account.password_hash = newPassword;
        await account.save();

        await logActivity(principal.username, 'Auth', 'Password changed');
        res.json({ message: 'Password updated successfully.' });
    } catch (err) {
        console.error('[AUTH_ERROR] changePassword failed:', err);
        throw err;
    }
}

module.exports = { adminLogin, userLogin, getMe, logout, changePassword };
