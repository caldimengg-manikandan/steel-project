const mongoose = require('mongoose');

const errorLogSchema = new mongoose.Schema({
    date: { type: String, default: '' },
    projectName: { type: String, default: '' },
    clientName: { type: String, default: '' },
    errorCategory: { type: String, default: '' },
    errorDescription: { type: String, default: '' },
    impact: { type: String, default: '' },
    pm: { type: String, default: '' },
    modeler: { type: String, default: '' },
    detailer: { type: String, default: '' },
    checker: { type: String, default: '' },
    rootCause: { type: String, default: '' },
    correctiveAction: { type: String, default: '' },
    severity: { type: String, default: '' },
    status: { type: String, default: '' },
    remarks: { type: String, default: '' },
    strikedOut: { type: Boolean, default: false },
}, {
    timestamps: true
});

module.exports = mongoose.model('ErrorLog', errorLogSchema);
