/**
 * ============================================================
 * Transmittal Model
 * ============================================================
 * Each transmittal is a versioned snapshot of drawings sent
 * for a project at a specific point in time.
 *
 * Transmittal 1 → initial batch of drawings
 * Transmittal 2 → only NEW or REVISED drawings since T1
 * Transmittal N → only NEW or REVISED drawings since T(N-1)
 *
 * Isolation: projectId + createdByAdminId enforce tenant scope.
 */
const mongoose = require('mongoose');

const transmittalDrawingSchema = new mongoose.Schema(
    {
        extractionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'DrawingExtraction',
            required: true,
        },
        drawingNumber: { type: String, default: '' },
        drawingTitle: { type: String, default: '' },
        revision: { type: String, default: '' },
        date: { type: String, default: '' },
        remarks: { type: String, default: '' },
        folderName: { type: String, default: '' },
        originalFileName: { type: String, default: '' },
        // 'new' = first time this drawing number appears
        // 'revised' = drawing number existed but revision changed
        changeType: {
            type: String,
            enum: ['new', 'revised'],
            default: 'new',
        },
        previousRevision: { type: String, default: '' }, // filled for 'revised' type
    },
    { _id: false }
);

const transmittalSchema = new mongoose.Schema(
    {
        // ── Tenant keys ─────────────────────────────────────────
        projectId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Project',
            required: true,
            index: true,
        },
        createdByAdminId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Admin',
            required: true,
            index: true,
        },

        // ── Transmittal metadata ─────────────────────────────────
        transmittalNumber: {
            type: Number,
            required: true,
            min: 1,
        },

        // ── Drawings included in this transmittal ───────────────
        drawings: {
            type: [transmittalDrawingSchema],
            default: [],
        },

        // ── Snapshot counts ──────────────────────────────────────
        newCount: { type: Number, default: 0 },
        revisedCount: { type: Number, default: 0 },

        sequences: { type: [String], default: [] },

        // ── Link to generated Excel file ─────────────────────────
        excelPath: { type: String, default: '' },
        excelUrl: { type: String, default: '' },
    },
    {
        timestamps: true,
        collection: 'transmittals',
    }
);

transmittalSchema.index({ projectId: 1, transmittalNumber: 1 }, { unique: true });
transmittalSchema.index({ createdByAdminId: 1, projectId: 1 });

module.exports = mongoose.model('Transmittal', transmittalSchema);
