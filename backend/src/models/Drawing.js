/**
 * ============================================================
 * Drawing Model
 * ============================================================
 * Drawings belong to a Project, which belongs to an Admin.
 * Isolation flows up: Admin → Project → Drawing.
 */
const mongoose = require('mongoose');

const revisionEntrySchema = new mongoose.Schema(
    {
        revMark: { type: String, required: true },
        date: { type: String, required: true },
        description: { type: String, default: '' },
        revisedBy: { type: String, required: true },
        revisedAt: { type: Date, default: Date.now },
    },
    { _id: true }
);

const drawingSchema = new mongoose.Schema(
    {
        projectId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Project',
            required: true,
            index: true,
        },

        // Redundant for fast scoped queries with adminId
        createdByAdminId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Admin',
            required: true,
            index: true,
        },

        sheetNo: { type: String, required: true, trim: true },
        description: { type: String, required: true, trim: true },
        revisionMark: { type: String, default: 'Rev 0' },
        date: { type: String, default: '' },
        remarks: { type: String, default: '' },
        fileName: { type: String, required: true },
        fileUrl: { type: String, default: '' },
        uploadedBy: { type: String, required: true },

        revisions: {
            type: [revisionEntrySchema],
            default: [],
        },
    },
    {
        timestamps: true,
        collection: 'drawings',
    }
);

drawingSchema.index({ projectId: 1, sheetNo: 1 });
drawingSchema.index({ createdByAdminId: 1, projectId: 1 });

module.exports = mongoose.model('Drawing', drawingSchema);
