// backend-cjs/mongoose/models/SyncJob.js
// -----------------------------------------------------------------------------
// Mongoose Model: SyncJob
// Tracks background email synchronization progress and status.
// -----------------------------------------------------------------------------

const mongoose = require('mongoose');

const syncJobSchema = new mongoose.Schema(
  {
    triggeredBy: {
      type: mongoose.Schema.Types.Mixed,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'PARTIAL'],
      default: 'PENDING',
    },
    windowStart: {
      type: Date,
      required: true,
    },
    windowEnd: {
      type: Date,
      required: true,
    },
    pagesFetched: {
      type: Number,
      default: 0,
    },
    messagesSynced: {
      type: Number,
      default: 0,
    },
    lastNextLink: {
      type: String,
    },
    errorMessage: {
      type: String,
    },
    startedAt: {
      type: Date,
    },
    completedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    collection: 'sync_jobs',
  }
);

module.exports = mongoose.model('SyncJob', syncJobSchema);
