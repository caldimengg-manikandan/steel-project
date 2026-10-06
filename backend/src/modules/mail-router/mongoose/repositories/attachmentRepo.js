// backend-cjs/mongoose/repositories/attachmentRepo.js
const Attachment = require('../models/Attachment');

async function upsertAttachment(firstArg, secondArg, thirdArg) {
  let emailId;
  let attachmentMeta;
  let content;

  if (typeof firstArg === 'object' && firstArg.emailId) {
    emailId = firstArg.emailId;
    attachmentMeta = firstArg;
    content = firstArg.content || null;
  } else {
    emailId = firstArg;
    attachmentMeta = secondArg || {};
    content = thirdArg || attachmentMeta.content || null;
  }

  const mongoose = require('mongoose');
  const targetEmailId = (typeof emailId === 'string' && mongoose.Types.ObjectId.isValid(emailId))
    ? new mongoose.Types.ObjectId(emailId)
    : (emailId && emailId._id) ? emailId._id : emailId;

  const ids = [targetEmailId];
  if (typeof emailId === 'string' && !ids.includes(emailId)) {
    ids.push(emailId);
  } else if (emailId && emailId.toString && !ids.includes(emailId.toString())) {
    ids.push(emailId.toString());
  }

  const filter = {
    emailId: { $in: ids },
    providerAttachmentId: attachmentMeta.providerAttachmentId || attachmentMeta.id,
  };

  const update = {
    emailId: targetEmailId,
    filename: attachmentMeta.filename || attachmentMeta.name,
    contentType: attachmentMeta.contentType || 'application/octet-stream',
    sizeBytes: attachmentMeta.sizeBytes || attachmentMeta.size || null,
  };

  if (attachmentMeta.contentId !== undefined) {
    update.contentId = attachmentMeta.contentId;
  }
  if (attachmentMeta.isInline !== undefined) {
    update.isInline = attachmentMeta.isInline;
  }

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
  if (!emailId) return [];
  const mongoose = require('mongoose');
  const ids = [emailId];
  if (typeof emailId === 'string' && mongoose.Types.ObjectId.isValid(emailId)) {
    ids.push(new mongoose.Types.ObjectId(emailId));
  } else if (emailId && emailId.toString) {
    ids.push(emailId.toString());
  }
  return Attachment.find({ emailId: { $in: ids } }).select('-content').lean();
}

async function getAttachmentById(id) {
  if (!id) return null;
  const mongoose = require('mongoose');
  const ids = [id];
  if (typeof id === 'string' && mongoose.Types.ObjectId.isValid(id)) {
    ids.push(new mongoose.Types.ObjectId(id));
  }
  return Attachment.findOne({ _id: { $in: ids } });
}

module.exports = {
  upsertAttachment,
  listAttachmentsByEmail,
  getAttachmentById,
};

