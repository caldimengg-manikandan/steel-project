const mongoose = require('mongoose');

const ActivityLogSchema = new mongoose.Schema({
    user: {
        type: String,
        required: true,
        default: 'System'
    },
    module: {
        type: String,
        required: true
    },
    event: {
        type: String,
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

// Index to optimize querying logs in chronological order
ActivityLogSchema.index({ timestamp: -1 });

module.exports = mongoose.model('ActivityLog', ActivityLogSchema);
