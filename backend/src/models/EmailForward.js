// backend-cjs/mongoose/models/EmailForward.js
// -----------------------------------------------------------------------------
// Mongoose Model: EmailForward
// Stores forwarded / triaged emails assigned to specific employees/detailers.
// Powers the Employee Inbox, read/unread tracking, and PM notes.
// -----------------------------------------------------------------------------

const mongoose = require('mongoose');

const emailForwardSchema = new mongoose.Schema(
  {
    emailId: {
      type: mongoose.Schema.Types.Mixed,
      ref: 'Email',
      required: true,
      index: true,
    },
    recipientId: {
      type: mongoose.Schema.Types.Mixed,
      ref: 'User',
      required: true,
      index: true,
    },
    forwardedBy: {
      type: mongoose.Schema.Types.Mixed,
      ref: 'User',
      required: true,
    },
    note: {
      type: String,
      trim: true,
      default: '',
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    readAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'email_forwards',
  }
);

emailForwardSchema.index({ recipientId: 1, isRead: 1 });
emailForwardSchema.index({ emailId: 1, recipientId: 1 }, { unique: true });

module.exports = mongoose.model('EmailForward', emailForwardSchema);
