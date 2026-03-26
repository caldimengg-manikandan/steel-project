/**
 * ============================================================
 * Admin Users Controller
 * ============================================================
 * ALL operations are automatically scoped to req.principal.adminId.
 * An admin can ONLY ever see or modify users with that adminId.
 *
 * Routes:
 *   GET    /api/admin/users              — list own users
 *   POST   /api/admin/users              — create user under this admin
 *   GET    /api/admin/users/:userId      — get one user (scopeUserToAdmin)
 *   PATCH  /api/admin/users/:userId      — update user
 *   DELETE /api/admin/users/:userId      — remove user
 */
const User = require('../models/User');
const Project = require('../models/Project');

/**
 * GET /api/admin/users
 * Returns ONLY users belonging to the logged-in admin.
 */
async function listUsers(req, res) {
    const adminId = req.principal.adminId;

    const users = await User
        .find({ adminId })
        .select('-password_hash')
        .sort({ createdAt: -1 });

    res.json({ count: users.length, users });
}

/**
 * POST /api/admin/users
 * Creates a new user under the logged-in admin.
 * adminId is injected server-side — client cannot override it.
 */
async function createUser(req, res) {
    const adminId = req.principal.adminId;
    const { username, email, password, displayName } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ error: 'username, email and password are required.' });
    }

    // Enforce minimum password strength (changed to just required)
    if (password.length < 1) {
        return res.status(400).json({ error: 'Password is required.' });
    }

    const user = await User.create({
        username,
        email,
        password_hash: password,   // pre-save hook hashes it
        displayName: displayName || username,
        adminId,                   // ← injected — cannot be spoofed by client
        role: 'user',
        status: 'active',
    });

    res.status(201).json({ user: user.toSafeObject() });
}

/**
 * GET /api/admin/users/:userId
 * req.scopedUser is pre-loaded by scopeUserToAdmin middleware.
 */
async function getUser(req, res) {
    res.json({ user: req.scopedUser.toSafeObject() });
}

/**
 * PATCH /api/admin/users/:userId
 * Allows updating: displayName, email, status, password.
 * Does NOT allow changing adminId or role.
 */
async function updateUser(req, res) {
    const user = req.scopedUser;
    const { displayName, email, status, password } = req.body;

    if (displayName !== undefined) user.displayName = displayName;
    if (email !== undefined) user.email = email;
    if (status !== undefined) {
        if (!['active', 'inactive'].includes(status)) {
            return res.status(400).json({ error: 'status must be active or inactive.' });
        }
        user.status = status;
    }
    if (password !== undefined) {
        if (password.length < 1) return res.status(400).json({ error: 'Password cannot be empty.' });
        user.password_hash = password;   // hook will re-hash
    }

    await user.save();
    res.json({ user: user.toSafeObject() });
}

/**
 * DELETE /api/admin/users/:userId
 * Also removes this user from all project assignments within the admin scope.
 */
async function deleteUser(req, res) {
    const user = req.scopedUser;
    const adminId = req.principal.adminId;

    // Remove user from all project assignments (within this admin only)
    await Project.updateMany(
        { createdByAdminId: adminId },
        { $pull: { assignments: { userId: user._id } } }
    );

    await user.deleteOne();

    res.json({ message: `User "${user.username}" deleted. All project assignments removed.` });
}

/**
 * POST /api/admin/users/bulk
 * Processes an Excel file to create multiple users.
 * Required columns: username, email, password
 * Optional columns: displayName
 */
async function bulkCreateUsers(req, res) {
    if (!req.file) {
        return res.status(400).json({ error: 'No Excel file uploaded.' });
    }

    const adminId = req.principal.adminId;
    const fs = require('fs');
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();

    try {
        console.log(`[BULK UPLOAD] Processing file at: ${req.file.path}`);
        const buffer = fs.readFileSync(req.file.path);
        await workbook.xlsx.load(buffer);
        
        // Get the first worksheet
        const worksheet = workbook.worksheets[0];
        if (!worksheet) {
            return res.status(400).json({ error: 'The Excel file contains no worksheets.' });
        }

        const usersToCreate = [];
        const errors = [];

        // Identify columns based on header row (row 1)
        const headerRow = worksheet.getRow(1);
        if (!headerRow || !headerRow.values || (Array.isArray(headerRow.values) && headerRow.values.length === 0)) {
            return res.status(400).json({ error: 'The first row of the Excel sheet is empty. Header row required.' });
        }

        const colMap = {};
        headerRow.eachCell((cell, colNumber) => {
            const header = cell.value?.toString().toLowerCase().trim();
            if (header) colMap[header] = colNumber;
        });

        console.log(`[BULK UPLOAD] Admin ${adminId} | Sheet: "${worksheet.name}" | Headers:`, Object.keys(colMap));

        // Validate headers
        const required = ['username', 'email', 'password'];
        const missing = required.filter(h => !colMap[h]);
        if (missing.length > 0) {
            return res.status(400).json({ 
                error: `Missing required columns: ${missing.join(', ')}. Found: ${Object.keys(colMap).join(', ') || 'None'}` 
            });
        }

        // Parse rows starting from row 2
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return; // skip header
            if (!row.values || (Array.isArray(row.values) && row.values.length === 0)) return; // skip truly empty rows

            const usernameCell = colMap['username'] ? row.getCell(colMap['username']) : null;
            const emailCell = colMap['email'] ? row.getCell(colMap['email']) : null;
            const passwordCell = colMap['password'] ? row.getCell(colMap['password']) : null;
            const displayCell = colMap['displayname'] ? row.getCell(colMap['displayname']) : null;

            const username = usernameCell?.value?.toString().trim();
            const email = emailCell?.value?.toString().trim();
            const password = passwordCell?.value?.toString().trim();
            const displayName = displayCell?.value?.toString().trim() || username;

            if (!username || !email || !password) {
                // Only error if it's not a completely empty row (sometimes row.values has data but cells are blank)
                if (username || email || password) {
                    errors.push(`Row ${rowNumber}: Incomplete data (username, email, and password required).`);
                }
                return;
            }

            usersToCreate.push({
                username,
                email,
                password_hash: password,
                displayName,
                adminId,
                role: 'user',
                status: 'active'
            });
        });

        if (usersToCreate.length === 0) {
            return res.status(400).json({ error: 'The Excel file contains no valid user data.' });
        }

        // Create users one by one to handle duplicates or validation errors
        const results = {
            created: 0,
            skipped: 0,
            failedRows: errors
        };

        for (const userData of usersToCreate) {
            try {
                // Check if user already exists for this admin
                const exists = await User.findOne({ 
                    adminId, 
                    $or: [{ username: userData.username }, { email: userData.email }] 
                });

                if (exists) {
                    results.skipped++;
                    results.failedRows.push(`User "${userData.username}" or "${userData.email}" already exists.`);
                    continue;
                }

                await User.create(userData);
                results.created++;
            } catch (err) {
                results.skipped++;
                results.failedRows.push(`Error creating "${userData.username}": ${err.message}`);
            }
        }

        res.json({
            message: `Processed ${usersToCreate.length} rows. Created ${results.created} users, skipped ${results.skipped}.`,
            results
        });

    } catch (error) {
        console.error('Excel processing error:', error);
        res.status(500).json({ error: `Excel processing failed: ${error.message}. Ensure it is a valid .xlsx file.` });
    } finally {
        // Clean up temp file
        const fs = require('fs');
        if (req.file.path && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
    }
}

module.exports = { listUsers, createUser, getUser, updateUser, deleteUser, bulkCreateUsers };

