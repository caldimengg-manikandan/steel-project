const mongoose = require('mongoose');

const rfiReportSchema = new mongoose.Schema({
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project',
        required: true,
        index: true
    },
    reportDate: {
        type: String, // e.g., 'YYYY-MM-DD'
        required: true
    },
    status: {
        type: String,
        enum: ['Draft', 'Final'],
        default: 'Draft'
    },
    rfiData: [{
        isCustomRow: Boolean,
        rfiNumber: String,
        questionNumber: String,
        clientRfiNumber: String,
        status: String,
        priority: String,
        sentDate: String,
        seqArea: String,
        rfiType: String,
        description: String,
        receivedDate: String,
        remarks: String
    }],
    cdrfiData: [{
        isCustomRow: Boolean,
        caldimCdrfiNo: String,
        clientCdrfiNo: String,
        status: String,
        priority: String,
        sentDate: String,
        seqArea: String,
        cdrfiType: String,
        description: String,
        receivedDate: String,
        remarks: String
    }],
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Update the updatedAt timestamp before saving
rfiReportSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.model('RfiReport', rfiReportSchema);
