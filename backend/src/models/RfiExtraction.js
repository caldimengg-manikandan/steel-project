const mongoose = require('mongoose');

const rfiItemSchema = new mongoose.Schema({
    rfiNumber: String,
    refDrawing: String,
    description: String,
    response: { type: String, default: '' },
    status: { type: String, default: 'OPEN' }, // OPEN | CLOSED
    remarks: { type: String, default: '' },
    skNumber: { type: String, default: '' },
    sentOn: { type: Date, default: Date.now },
    closedOn: Date,
    responseAttachmentUrl: String,
    responseAttachmentName: String,
});

const rfiExtractionSchema = new mongoose.Schema(
    {
        projectId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Project',
            required: true,
            index: true,
        },
        createdByAdminId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        uploadedBy: {
            type: String, // username of uploader
            required: true,
        },
        originalFileName: {
            type: String,
            required: true,
        },
        status: {
            type: String,
            enum: ['queued', 'processing', 'completed', 'failed'],
            default: 'queued',
        },
        folderName: {
            type: String,
            default: '',
        },
        fileUrl: {
            type: String,
            required: true, // we store the PDF to re-download if needed
        },
        errorDetails: {
            type: String,
        },
        rfis: {
            type: [rfiItemSchema],
            default: [],
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model('RfiExtraction', rfiExtractionSchema);
