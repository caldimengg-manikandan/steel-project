const mongoose = require('mongoose');

const weeklyProgressSchema = new mongoose.Schema({
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project',
        required: true,
        index: true
    },
    weekStartDate: {
        type: String, // e.g., 'YYYY-MM-DD'
        required: true
    },
    status: {
        type: String,
        enum: ['Draft', 'Final'],
        default: 'Draft'
    },
    summaryData: {
        date: String,
        projectName: String,
        projectNo: String,
        clientName: String,
        clientProjectNo: String,
        clientAddress: String,
        clientProjectManager: String,
        reportCirculatedTo1: String,
        caldimProjectManager: String,
        reportCirculatedTo2: String,
        projectType: String,
        projectDescription: String,
        projectStatusLastWeek: String,
        overallApprovalStatus: String,
        overallFabricationStatus: String
    },
    sowData: [{
        sNo: String,
        description: String,
        change: String,
        receivedDate: String,
        remarks: String
    }],
    scheduleData: [{
        sNo: String,
        seqArea: String,
        status: String,
        plannedIfaDate: String,
        actualIfaDate: String,
        bfaReceivedDate: String,
        plannedFabDate: String,
        actualFabDate: String,
        remarks: String
    }],
    // Store manual overrides and custom rows for the Transmittal Log
    rfiData: [{
        isCustomRow: Boolean,
        rfiNumber: String,
        clientRfiNumber: String,
        status: String,
        priority: String,
        description: String,
        sentDate: String,
        seqArea: String,
        rfiType: String,
        receivedDate: String,
        remarks: String
    }],
    rfiData: [{
        isCustomRow: Boolean,
        rfiNumber: String,
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
    transmittalData: [{
        isCustomRow: Boolean, // true if user manually added a row not from source
        transmittalNo: String, // key to link back to source data if not custom
        date: String,
        appFab: String,
        numberOfSheets: String,
        seqArea: String,
        remarks: String
    }]
}, { timestamps: true });

// Ensure one report per project per week
weeklyProgressSchema.index({ projectId: 1, weekStartDate: 1 }, { unique: true });

module.exports = mongoose.model('WeeklyProgress', weeklyProgressSchema);
