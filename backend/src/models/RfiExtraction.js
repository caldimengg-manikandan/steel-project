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
    clientRfiNumber: { type: String, default: '' },
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
            default: '',
        },
        gridFsFileId: {
            type: mongoose.Schema.Types.ObjectId,
            index: true,
        },
        errorDetails: {
            type: String,
        },
        rfis: {
            type: [rfiItemSchema],
            default: [],
        },
        sequences: {
            type: [String],
            default: [],
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model('RfiExtraction', rfiExtractionSchema);
