/**
 * ============================================================
 * DrawingExtraction Model
 * ============================================================
 * Stores every uploaded PDF + its AI-extracted structured fields,
 * extraction status, confidence score, and generated Excel path.
 *
 * Isolation: every record carries createdByAdminId so that
 * admin-scoped queries never cross tenant boundaries.
 */
const mongoose = require('mongoose');

// ── Extracted fields sub-document ─────────────────────────
const extractedFieldsSchema = new mongoose.Schema(
    {
        drawingNumber: { type: String, default: '' },   // Sheet No / DWG No
        drawingTitle: { type: String, default: '' },   // Title block title
        description: { type: String, default: '' },   // General description
        drawingDescription: { type: String, default: '' },   // DWG DESCRIPTION field
        revision: { type: String, default: '' },   // Latest revision mark
        date: { type: String, default: '' },   // Revision date
        remarks: { type: String, default: '' }, // Added for transmittal consistency
        scale: { type: String, default: '' },   // Drawing scale
        clientName: { type: String, default: '' },
        projectName: { type: String, default: '' },
        // Full revision history from the revision table
        revisionHistory: [
            {
                mark: { type: String, default: '' },
                date: { type: String, default: '' },
                remarks: { type: String, default: '' },
            },
        ],
    },
    { _id: false }
);

// ── Validation result sub-document ────────────────────────
const validationResultSchema = new mongoose.Schema(
    {
        drawingNumberValid: { type: Boolean, default: null },
        revisionValid: { type: Boolean, default: null },
        dateValid: { type: Boolean, default: null },
        warnings: [{ type: String }],
    },
    { _id: false }
);

// ── Main DrawingExtraction schema ──────────────────────────
const drawingExtractionSchema = new mongoose.Schema(
    {
        // ── Tenant isolation keys ──
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

        // ── Upload metadata ──
        originalFileName: { type: String, required: true },
        fileUrl: { type: String, required: true }, // Stored path on disk
        folderName: { type: String, default: '' },
        fileSize: { type: Number, default: 0 }, // Bytes
        uploadedBy: { type: String, required: true }, // username
        localSavePath: { type: String, default: '' }, // Desktop absolute path to save Excel
        // Optional: which transmittal number this upload batch belongs to.
        // null / undefined = system auto-assigns the next number ("Create New")
        // integer = append to that existing transmittal slot
        targetTransmittalNumber: { type: Number, default: null },

        // Target sequences for the transmittal mapping
        sequences: { type: [String], default: [] },

        // ── Extraction metadata ──
        status: {
            type: String,
            enum: ['queued', 'processing', 'completed', 'failed'],
            default: 'queued',
            index: true,
        },
        errorMessage: { type: String, default: '' },
        extractionConfidence: { type: Number, default: 0, min: 0, max: 1 },
        processingTimeMs: { type: Number, default: 0 },

        // ── Extracted structured data ──
        extractedFields: {
            type: extractedFieldsSchema,
            default: () => ({}),
        },

        // ── Validation results ──
        validationResult: {
            type: validationResultSchema,
            default: () => ({}),
        },

        // ── Excel output ──
        excelPath: { type: String, default: '' },  // Path to generated Excel
        excelUrl: { type: String, default: '' },  // Download URL
    },
    {
        timestamps: true,
        collection: 'drawing_extractions',
    }
);

// Indexes for common query patterns
drawingExtractionSchema.index({ projectId: 1, createdAt: -1 });
drawingExtractionSchema.index({ createdByAdminId: 1, status: 1 });

// Indexes for duplicate detection (sheet number + revision per project)
drawingExtractionSchema.index({ projectId: 1, 'extractedFields.drawingNumber': 1 });
drawingExtractionSchema.index({
    projectId: 1,
    'extractedFields.drawingNumber': 1,
    'extractedFields.revision': 1,
});
drawingExtractionSchema.index({ projectId: 1, targetTransmittalNumber: 1 });

module.exports = mongoose.model('DrawingExtraction', drawingExtractionSchema);
