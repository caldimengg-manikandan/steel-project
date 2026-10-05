// backend-cjs/mongoose/models/Email.js
// -----------------------------------------------------------------------------
// Mongoose Model: Email
// Stores synchronized emails, HTML/plain bodies, attachments flag, links,
// and triage status. Can be linked directly to Steel Detailing projects.
// -----------------------------------------------------------------------------

const mongoose = require('mongoose');

const emailSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.Mixed,
      ref: 'User',
      index: true,
    },
    accountId: {
      type: mongoose.Schema.Types.Mixed,
      ref: 'MailAccount',
      index: true,
    },
    syncJobId: {
      type: mongoose.Schema.Types.Mixed,
      ref: 'SyncJob',
    },
    provider: {
      type: String,
      enum: ['MICROSOFT', 'ZOHO'],
      required: true,
    },
    providerMessageId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    mailboxAddress: {
      type: String,
      default: '',
    },
    fromName: {
      type: String,
    },
    fromAddress: {
      type: String,
      required: true,
    },
    toName: {
      type: String,
    },
    toAddress: {
      type: String,
    },
    subject: {
      type: String,
      default: '(No Subject)',
    },
    receivedAt: {
      type: Date,
      required: true,
      index: true,
    },
    bodyPreview: {
      type: String,
    },
    bodyText: {
      type: String,
    },
    bodyHtml: {
      type: String,
    },
    hasAttachments: {
      type: Boolean,
      default: false,
    },
    internetMessageId: {
      type: String,
    },
    links: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    triageStatus: {
      type: String,
      enum: ['NEW', 'REVIEWED', 'FORWARDED', 'ARCHIVED'],
      default: 'NEW',
    },
    folder: {
      type: String,
      default: 'inbox',
      index: true,
    },
    remoteFolderId: {
      type: String,
      index: true,
    },
    isSpam: {
      type: Boolean,
      default: false,
      index: true,
    },
    isForwarded: {
      type: Boolean,
      default: false,
      index: true,
    },
    // Native Steel Detailing project extension
    projectId: {
      type: mongoose.Schema.Types.Mixed,
      ref: 'Project',
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'emails',
  }
);

emailSchema.index({ userId: 1, receivedAt: -1 });
emailSchema.index({ provider: 1, receivedAt: -1 });
emailSchema.index({ accountId: 1, receivedAt: -1 });
emailSchema.index({ provider: 1, receivedAt: -1, accountId: 1 });
emailSchema.index({ isForwarded: 1, receivedAt: -1 });
emailSchema.index({ userId: 1, isForwarded: 1, receivedAt: -1 });
emailSchema.index({ provider: 1, isForwarded: 1, receivedAt: -1 });
emailSchema.index({ triageStatus: 1, receivedAt: -1 });

module.exports = mongoose.model('Email', emailSchema);

