/**
 * ============================================================
 * Project Model
 * ============================================================
 * A Project always belongs to ONE Admin (createdByAdminId).
 * Assignments are sub-documents; each assignment references a
 * User who MUST belong to the same admin (enforced in controller).
 */
const mongoose = require('mongoose');

// ── Assignment sub-document ────────────────────────────────
const assignmentSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        username: {
            type: String,
            required: true,
        },
        permission: {
            type: String,
            enum: ['viewer', 'editor', 'admin'],
            default: 'viewer',
        },
        assignedAt: {
            type: Date,
            default: Date.now,
        },
    },
    { _id: false }
);

// ── Project schema ─────────────────────────────────────────
const projectSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, 'Project name is required'],
            trim: true,
            maxlength: 120,
        },

        clientName: {
            type: String,
            required: [true, 'Client name is required'],
            trim: true,
            maxlength: 120,
        },

        clientId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Client',
            default: null,
        },

        contactPerson: {
            type: {
                name: String,
                email: String,
                phone: String,
                designation: String
            },
            default: null
        },

        description: {
            type: String,
            default: '',
            maxlength: 1000,
        },

        status: {
            type: String,
            enum: ['active', 'on_hold', 'completed', 'archived'],
            default: 'active',
        },

        location: {
            type: String,
            enum: ['Chennai', 'Hosur', ''],
            default: '',
        },

        // ── Multi-Tenant Key ──────────────────────────────────
        /**
         * createdByAdminId: The Admin who owns this project.
         * ALL project queries filter by this field.
         * IMMUTABLE — a project cannot be transferred between admins.
         */
        createdByAdminId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Admin',
            required: [true, 'createdByAdminId is required'],
            immutable: true,
            index: true,
        },

        // ── User Assignments ──────────────────────────────────
        assignments: {
            type: [assignmentSchema],
            default: [],
        },

        drawingCount: {
            type: Number,
            default: 0,
            min: 0,
        },

        approximateDrawingsCount: {
            type: Number,
            default: 0,
            min: 0,
        },

        // ── Transmittal Counter ────────────────────────────────
        // Auto-incremented each time a transmittal is downloaded.
        // Scoped per-project so each project starts from #01.
        transmittalCount: {
            type: Number,
            default: 0,
            min: 0,
        },
        // ── Sequence Progress ─────────────────────────────────
        sequences: {
            type: [{
                name: { type: String, required: true },
                status: { type: String, enum: ['Completed', 'Not Completed'], default: 'Not Completed' },
                deadline: { type: Date },
                approvalDate: { type: Date, default: null },
                fabricationDate: { type: Date, default: null }
            }],
            default: []
        },

        // ── Connection Design ─────────────────────────────────
        connectionDesignVendor: {
            type: String,
            default: '',
        },
        connectionDesignContact: {
            type: String,
            default: '',
        },
    },
    {
        timestamps: true,
        collection: 'projects',
    }
);

/* ── Indexes ──────────────────────────────────────────────── */

// Fast scoped project list per admin
projectSchema.index({ createdByAdminId: 1, status: 1 });
projectSchema.index({ createdByAdminId: 1, createdAt: -1 });

// Fast user → projects lookup for "my assigned projects"
projectSchema.index({ 'assignments.userId': 1 });

module.exports = mongoose.model('Project', projectSchema);
