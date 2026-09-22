// backend-cjs/mongoose/repositories/forwardingRepo.js
// -----------------------------------------------------------------------------
// Mongoose Repository for Forwarding & Employee Inbox
// -----------------------------------------------------------------------------

const mongoose = require('mongoose');
const EmailForward = require('../models/EmailForward');
const Email = require('../models/Email');

/**
 * Forward an email to one or more employee recipients.
 * Creates an EmailForward document for each recipient.
 */
async function createForwarding(emailId, forwardedBy, recipientIds, note) {
  if (!recipientIds || !Array.isArray(recipientIds) || recipientIds.length === 0) {
    throw new Error('At least one recipient ID is required.');
  }

  const createdDocs = [];

  for (const recipientId of recipientIds) {
    const doc = await EmailForward.findOneAndUpdate(
      { emailId, recipientId },
      {
        emailId,
        recipientId,
        forwardedBy,
        note: note || '',
        isRead: false,
        readAt: null,
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );
    createdDocs.push(doc);
  }

  // Update email triage status to FORWARDED
  await Email.findByIdAndUpdate(emailId, { triageStatus: 'FORWARDED' });

  return {
    success: true,
    count: createdDocs.length,
    forwards: createdDocs,
  };
}

/**
 * List forwarded emails for an employee's personal inbox.
 */
async function listMailboxItems(recipientId, limit = 50, offset = 0) {
  const forwards = await EmailForward.find({ recipientId })
    .sort({ createdAt: -1 })
    .skip(offset)
    .limit(limit)
    .populate('emailId')
    .lean();

  return forwards.map((fw) => {
    const email = fw.emailId || {};
    return {
      id: String(fw._id),
      forwardingId: String(fw._id),
      emailId: String(email._id || fw.emailId),
      recipientId: String(fw.recipientId),
      forwardedBy: String(fw.forwardedBy),
      forwardedAt: fw.createdAt ? new Date(fw.createdAt).toISOString() : new Date().toISOString(),
      note: fw.note || '',
      readAt: fw.readAt ? new Date(fw.readAt).toISOString() : null,
      isRead: Boolean(fw.isRead),
      // Email details
      subject: email.subject || '(No Subject)',
      fromName: email.fromName || '',
      fromAddress: email.fromAddress || '',
      receivedAt: email.receivedAt ? new Date(email.receivedAt).toISOString() : null,
      bodyPreview: email.bodyPreview || '',
      hasAttachments: Boolean(email.hasAttachments),
      provider: email.provider || 'MICROSOFT',
    };
  });
}

/**
 * Get a single forwarded email item for an employee.
 */
async function getMailboxItem(recipientId, emailId) {
  const fw = await EmailForward.findOne({ recipientId, emailId })
    .populate('emailId')
    .lean();

  if (!fw) return null;

  const email = fw.emailId || {};
  return {
    id: String(fw._id),
    forwardingId: String(fw._id),
    emailId: String(email._id || fw.emailId),
    recipientId: String(fw.recipientId),
    forwardedBy: String(fw.forwardedBy),
    forwardedAt: fw.createdAt ? new Date(fw.createdAt).toISOString() : new Date().toISOString(),
    note: fw.note || '',
    readAt: fw.readAt ? new Date(fw.readAt).toISOString() : null,
    isRead: Boolean(fw.isRead),
    // Complete email content
    subject: email.subject || '(No Subject)',
    fromName: email.fromName || '',
    fromAddress: email.fromAddress || '',
    receivedAt: email.receivedAt ? new Date(email.receivedAt).toISOString() : null,
    bodyPreview: email.bodyPreview || '',
    bodyText: email.bodyText || '',
    bodyHtml: email.bodyHtml || '',
    links: email.links || [],
    hasAttachments: Boolean(email.hasAttachments),
    provider: email.provider || 'MICROSOFT',
  };
}

/**
 * Mark a forwarded email as read for an employee.
 */
async function markAsRead(recipientId, emailId) {
  return EmailForward.findOneAndUpdate(
    { recipientId, emailId, isRead: false },
    { isRead: true, readAt: new Date() },
    { new: true }
  );
}

/**
 * Count unread emails for an employee's badge counter.
 */
async function countUnread(recipientId) {
  return EmailForward.countDocuments({ recipientId, isRead: false });
}

/**
 * List employees/detailers available for PM assignment.
 * Queries Mongoose User model or native users collection directly.
 */
async function listEmployees() {
  const roleQuery = {
    $or: [
      { role: { $in: ['EMPLOYEE', 'DETAILER', 'employee', 'detailer'] } },
      { roles: { $in: ['EMPLOYEE', 'DETAILER', 'employee', 'detailer'] } },
    ],
  };

  try {
    const UserModel = mongoose.models.User || (mongoose.modelNames().includes('User') ? mongoose.model('User') : null);
    if (UserModel) {
      const users = await UserModel.find(roleQuery).select('_id name email role roles').lean();
      return users.map((u) => ({
        id: String(u._id),
        name: u.name || u.username || u.email,
        email: u.email,
        role: u.role || (Array.isArray(u.roles) ? u.roles[0] : 'EMPLOYEE'),
      }));
    }
  } catch (_e) {
    // ignore and try collection fallback
  }

  try {
    if (mongoose.connection && mongoose.connection.db) {
      const users = await mongoose.connection.db.collection('users').find(roleQuery).toArray();
      return users.map((u) => ({
        id: String(u._id),
        name: u.name || u.username || u.email,
        email: u.email,
        role: u.role || 'EMPLOYEE',
      }));
    }
  } catch (_e) {
    // fallback
  }

  return [];
}

module.exports = {
  createForwarding,
  listMailboxItems,
  getMailboxItem,
  markAsRead,
  countUnread,
  listEmployees,
};
