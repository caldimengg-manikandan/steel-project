// backend-cjs/mongoose/models/MailFolder.js
// -----------------------------------------------------------------------------
// Mongoose Model: MailFolder
// Stores mapping: App Folder -> Provider -> Remote Folder ID
// Prevents duplicate folder mappings per user and provider.
// -----------------------------------------------------------------------------

const mongoose = require('mongoose');

const mailFolderSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.Mixed,
      ref: 'User',
      required: true,
      index: true,
    },
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MailAccount',
      index: true,
    },
    provider: {
      type: String,
      enum: ['MICROSOFT', 'ZOHO'],
      required: true,
      index: true,
    },
    // The unique slug / key used in the app (e.g. 'springfield' or 'folder_1727788888')
    folderId: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    // Display name in UI sidebar (e.g. "SpringField")
    name: {
      type: String,
      required: true,
      trim: true,
    },
    // Remote folder ID from the provider (e.g. Graph ID or Zoho folderId string)
    remoteFolderId: {
      type: String,
      required: true,
      trim: true,
    },
    icon: {
      type: String,
      default: 'folder',
    },
    order: {
      type: Number,
      default: 10,
    },
  },
  { timestamps: true }
);

// Prevent duplicate mappings:
// 1) Same remoteFolderId cannot be mapped twice for the same user and provider
mailFolderSchema.index({ userId: 1, provider: 1, remoteFolderId: 1 }, { unique: true });
// 2) Unique folderId slug per user and provider
mailFolderSchema.index({ userId: 1, provider: 1, folderId: 1 }, { unique: true });

module.exports = mongoose.models.MailFolder || mongoose.model('MailFolder', mailFolderSchema);
