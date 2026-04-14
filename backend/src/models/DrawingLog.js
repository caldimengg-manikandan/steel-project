/**
 * ============================================================
 * DrawingLog Model
 * ============================================================
 * One document per project. Created once on Transmittal 1.
 * Updated incrementally on every subsequent transmittal.
 *
 * Rules:
 *  - Never recreated / reset. Only appended / updated.
 *  - Each drawing entry maintains full revision history.
 *  - A drawing row is uniquely identified by drawingNumber.
 *
 * Isolation: projectId + createdByAdminId enforce tenant scope.
 */
const mongoose = require('mongoose');

// ── Revision history entry per drawing ──────────────────────
const revisionHistorySchema = new mongoose.Schema(
    {
        revision: { type: String, required: true },
        date: { type: String, default: '' },
        transmittalNo: { type: Number, required: true }, // Which transmittal introduced this revision
        remarks: { type: String, default: '' },
        recordedAt: { type: Date, default: Date.now },
    },
    { _id: true }
);

// ── Single drawing entry in the log ─────────────────────────
const drawingLogEntrySchema = new mongoose.Schema(
    {
        drawingNumber: { type: String, required: true, trim: true },
        drawingTitle: { type: String, default: '' },
        description: { type: String, default: '' },
        folderName: { type: String, default: '' },
        originalFileName: { type: String, default: '' },

        // Always points to the latest revision
        currentRevision: { type: String, default: '' },

        // Full chronological revision history
        revisionHistory: {
            type: [revisionHistorySchema],
            default: [],
        },

        // Transmittal when this drawing was first introduced
        firstTransmittalNo: { type: Number, default: 1 },

        lastUpdated: { type: Date, default: Date.now },
    },
    { _id: false }
);

// ── DrawingLog schema ────────────────────────────────────────
const drawingLogSchema = new mongoose.Schema(
    {
        // ── Tenant keys ───────────────────────────────────────
        projectId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Project',
            required: true,
            unique: true,   // One log per project
            index: true,
        },
        createdByAdminId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Admin',
            required: true,
            index: true,
        },

        // ── The master list of drawings ──────────────────────
        drawings: {
            type: [drawingLogEntrySchema],
            default: [],
        },

        // ── Snapshot of last transmittal applied ─────────────
        lastTransmittalNo: { type: Number, default: 0 },
    },
    {
        timestamps: true,   // createdAt = when Drawing Log was first created; updatedAt = last update
        collection: 'drawing_logs',
    }
);

drawingLogSchema.index({ createdByAdminId: 1, projectId: 1 });

module.exports = mongoose.model('DrawingLog', drawingLogSchema);
