// backend-cjs/mongoose/models/Attachment.js
// -----------------------------------------------------------------------------
// Mongoose Model: Attachment
// Stores file metadata and binary Buffer content for drawings, blueprints, PDFs.
// -----------------------------------------------------------------------------

const mongoose = require('mongoose');

const attachmentSchema = new mongoose.Schema(
  {
    emailId: {
      type: mongoose.Schema.Types.Mixed,
      ref: 'Email',
      required: true,
      index: true,
    },
    providerAttachmentId: {
      type: String,
      required: true,
    },
    filename: {
      type: String,
      required: true,
    },
    contentType: {
      type: String,
      default: 'application/octet-stream',
    },
    sizeBytes: {
      type: Number,
    },
    contentId: {
      type: String,
      index: true,
    },
    isInline: {
      type: Boolean,
      default: false,
    },
    content: {
      type: Buffer, // Binary file data
    },
  },
  {
    timestamps: true,
    collection: 'attachments',
  }
);

attachmentSchema.index({ emailId: 1, providerAttachmentId: 1 }, { unique: true });

module.exports = mongoose.model('Attachment', attachmentSchema);
