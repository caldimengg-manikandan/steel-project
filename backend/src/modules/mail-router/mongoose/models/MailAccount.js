// backend-cjs/mongoose/models/MailAccount.js
// -----------------------------------------------------------------------------
// Mongoose Model: MailAccount
// Stores connected Zoho and Microsoft mailboxes per user.
// Enforces: Max 1 Zoho + 1 Microsoft mailbox per user via compound index.
// -----------------------------------------------------------------------------

const mongoose = require('mongoose');

const mailAccountSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.Mixed,
      ref: 'User',
      required: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    provider: {
      type: String,
      enum: ['MICROSOFT', 'ZOHO'],
      required: true,
    },
    providerUserId: {
      type: String,
      default: 'me',
    },
    displayName: {
      type: String,
      trim: true,
    },
    accessToken: {
      type: String,
    },
    refreshToken: {
      type: String,
    },
    tokenExpiresAt: {
      type: Date,
    },
    providerMetadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastSyncAt: {
      type: Date,
    },
    lastSyncStatus: {
      type: String,
      enum: ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'PARTIAL'],
    },
  },
  {
    timestamps: true,
    collection: 'mail_accounts',
  }
);

// Enforce: exactly 1 mailbox per provider per user
mailAccountSchema.index({ userId: 1, provider: 1 }, { unique: true });

module.exports = mongoose.model('MailAccount', mailAccountSchema);
