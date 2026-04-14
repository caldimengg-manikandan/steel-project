/**
 * ============================================================
 * Admin Model
 * ============================================================
 * Top-level tenant.  Each Admin owns their own users and projects.
 * SuperAdmin is a special system-level role (optional, future use).
 */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminSchema = new mongoose.Schema(
    {
        username: {
            type: String,
            required: [true, 'Username is required'],
            unique: true,
            trim: true,
            lowercase: true,
            minlength: 3,
            maxlength: 40,
        },

        email: {
            type: String,
            required: [true, 'Email is required'],
            unique: true,
            trim: true,
            lowercase: true,
            match: [/.+@.+\..+/, 'Invalid email format'],
        },

        password_hash: {
            type: String,
            required: true,
            select: false,  // never returned in queries by default
        },

        displayName: {
            type: String,
            default: '',
        },

        role: {
            type: String,
            default: 'admin',
            enum: ['admin'],
        },

        status: {
            type: String,
            enum: ['active', 'inactive'],
            default: 'active',
        },

        // Optional: which superAdmin created this admin (for future SaaS hierarchy)
        createdBySuperAdmin: {
            type: Boolean,
            default: false,
        },
    },
    {
        timestamps: true,   // adds createdAt, updatedAt automatically
        collection: 'admins',
    }
);

/* ── Hooks ─────────────────────────────────────────────── */

// Hash password before save
adminSchema.pre('save', async function (next) {
    if (!this.isModified('password_hash')) return next();
    const salt = await bcrypt.genSalt(12);
    this.password_hash = await bcrypt.hash(this.password_hash, salt);
    next();
});

/* ── Instance Methods ─────────────────────────────────── */

// Compare plain password vs stored hash
adminSchema.methods.matchPassword = async function (plainPassword) {
    return bcrypt.compare(plainPassword, this.password_hash);
};

/* ── Static Methods ───────────────────────────────────── */

// Safe representation (strip sensitive fields)
adminSchema.methods.toSafeObject = function () {
    return {
        _id: this._id,
        username: this.username,
        email: this.email,
        displayName: this.displayName,
        role: this.role,
        status: this.status,
        createdAt: this.createdAt,
    };
};

module.exports = mongoose.model('Admin', adminSchema);
