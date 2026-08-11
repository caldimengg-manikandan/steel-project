/**
 * ============================================================
 * User Model
 * ============================================================
 * A User always belongs to exactly ONE Admin (adminId).
 * This is the CORE of multi-tenant isolation.
 * A user can be assigned to multiple projects, but only
 * projects that belong to the same admin.
 */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
    {
        // ── Identity ──────────────────────────────────────────
        username: {
            type: String,
            required: [true, 'Username is required'],
            trim: true,
            lowercase: true,
            minlength: 3,
            maxlength: 40,
        },

        email: {
            type: String,
            required: [true, 'Email is required'],
            trim: true,
            lowercase: true,
            match: [/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Invalid email format'],
        },

        password_hash: {
            type: String,
            required: true,
            select: false,
        },

        // ── Multi-Tenant Key ──────────────────────────────────
        /**
         * adminId: Reference to the Admin who created this user.
         * ALL queries MUST filter by adminId to maintain isolation.
         * This field is IMMUTABLE after creation.
         */
        adminId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Admin',
            required: [true, 'adminId is required — every user must belong to an admin'],
            immutable: true,   // cannot be changed after creation
            index: true,    // indexed for fast scoped queries
        },

        // ── Profile ───────────────────────────────────────────
        displayName: {
            type: String,
            default: '',
        },

        role: {
            type: String,
            enum: ['user', 'superadmin', 'project_manager', 'team_lead', 'team_member'],
            default: 'user',
        },

        status: {
            type: String,
            enum: ['active', 'inactive'],
            default: 'active',
        },
    },
    {
        timestamps: true,
        collection: 'users',
    }
);

/* ── Compound index: unique username per admin tenant ── */
// Two different admins CAN have users with same username
userSchema.index({ adminId: 1, username: 1 }, { unique: true });
// Two different admins CAN have users with same email (firm-level)
userSchema.index({ adminId: 1, email: 1 }, { unique: true });

/* ── Hooks ─────────────────────────────────────────────── */

userSchema.pre('save', async function (next) {
    if (!this.isModified('password_hash')) return next();
    const salt = await bcrypt.genSalt(12);
    this.password_hash = await bcrypt.hash(this.password_hash, salt);
    next();
});

/* ── Methods ──────────────────────────────────────────── */

userSchema.methods.matchPassword = async function (plain) {
    return bcrypt.compare(plain, this.password_hash);
};

userSchema.methods.toSafeObject = function () {
    return {
        _id: this._id,
        username: this.username,
        email: this.email,
        displayName: this.displayName,
        role: this.role,
        status: this.status,
        adminId: this.adminId,
        createdAt: this.createdAt,
    };
};

module.exports = mongoose.model('User', userSchema);
