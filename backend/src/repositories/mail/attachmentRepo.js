// backend-cjs/mongoose/repositories/attachmentRepo.js
const Attachment = require('../models/Attachment');

async function upsertAttachment(emailId, attachmentMeta, content) {
  const filter = {
    emailId,
    providerAttachmentId: attachmentMeta.providerAttachmentId || attachmentMeta.id,
  };

  const update = {
    filename: attachmentMeta.filename || attachmentMeta.name,
    contentType: attachmentMeta.contentType || 'application/octet-stream',
    sizeBytes: attachmentMeta.sizeBytes || attachmentMeta.size || null,
  };

  if (content) {
    update.content = content;
  }

  return Attachment.findOneAndUpdate(filter, update, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  });
}

async function listAttachmentsByEmail(emailId) {
  return Attachment.find({ emailId }).select('-content').lean();
}

async function getAttachmentById(id) {
  return Attachment.findById(id);
}

module.exports = {
  upsertAttachment,
  listAttachmentsByEmail,
  getAttachmentById,
};
