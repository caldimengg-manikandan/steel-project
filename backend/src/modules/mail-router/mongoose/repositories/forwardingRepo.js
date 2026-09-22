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
  let actualForwardedBy = forwardedBy;
  let actualRecipientIds = recipientIds;

  if (Array.isArray(forwardedBy) && !Array.isArray(recipientIds)) {
    actualRecipientIds = forwardedBy;
    actualForwardedBy = recipientIds;
  }

  if (!actualRecipientIds || !Array.isArray(actualRecipientIds) || actualRecipientIds.length === 0) {
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
  const recipientIds = [recipientId];
  if (typeof recipientId === 'string' && mongoose.Types.ObjectId.isValid(recipientId)) {
    recipientIds.push(new mongoose.Types.ObjectId(recipientId));
  } else if (recipientId && recipientId.toString) {
    recipientIds.push(recipientId.toString());
  }

  const forwards = await EmailForward.find({ recipientId: { $in: recipientIds } })
    .sort({ createdAt: -1 })
    .skip(offset)
    .limit(limit)
    .lean();

  if (!forwards || forwards.length === 0) {
    return [];
  }

  // 1. Gather all email IDs and forwarder IDs
  const emailIds = [];
  const forwarderIds = [];

  for (const fw of forwards) {
    const rawEid = (fw.emailId && fw.emailId._id) ? fw.emailId._id : fw.emailId;
    if (rawEid) emailIds.push(rawEid);
    if (fw.forwardedBy) forwarderIds.push(fw.forwardedBy);
  }

  // 2. Query Email documents by ID
  const emailsById = {};
  const eIdsToQuery = [];
  for (const id of emailIds) {
    eIdsToQuery.push(id);
    if (typeof id === 'string' && mongoose.Types.ObjectId.isValid(id)) {
      eIdsToQuery.push(new mongoose.Types.ObjectId(id));
    }
  }

  if (eIdsToQuery.length > 0) {
    const fetchedEmails = await Email.find({ _id: { $in: eIdsToQuery } }).lean();
    for (const e of fetchedEmails) {
      emailsById[String(e._id)] = e;
    }
  }

  // 3. Resolve forwarder names (from Admin or User)
  const forwarderNames = {};
  const uniqueForwarderIds = Array.from(new Set(forwarderIds.map(String)));
  if (uniqueForwarderIds.length > 0) {
    const fIdsToQuery = [];
    for (const fid of uniqueForwarderIds) {
      fIdsToQuery.push(fid);
      if (mongoose.Types.ObjectId.isValid(fid)) {
        fIdsToQuery.push(new mongoose.Types.ObjectId(fid));
      }
    }

    try {
      const AdminModel = mongoose.models.Admin || require('../../../../models/Admin');
      const UserModel = mongoose.models.User || require('../../../../models/User');
      const [admins, users] = await Promise.all([
        AdminModel.find({ _id: { $in: fIdsToQuery } }).select('username displayName email').lean().catch(() => []),
        UserModel.find({ _id: { $in: fIdsToQuery } }).select('username displayName email').lean().catch(() => [])
      ]);
      for (const a of admins) {
        forwarderNames[String(a._id)] = a.displayName || a.username || a.email;
      }
      for (const u of users) {
        forwarderNames[String(u._id)] = u.displayName || u.username || u.email;
      }
    } catch {
      // Direct collection fallback if models cannot be required
      try {
        if (mongoose.connection && mongoose.connection.db) {
          const [admins, users] = await Promise.all([
            mongoose.connection.db.collection('admins').find({ _id: { $in: fIdsToQuery } }).toArray().catch(() => []),
            mongoose.connection.db.collection('users').find({ _id: { $in: fIdsToQuery } }).toArray().catch(() => [])
          ]);
          for (const a of admins) {
            forwarderNames[String(a._id)] = a.displayName || a.username || a.email;
          }
          for (const u of users) {
            forwarderNames[String(u._id)] = u.displayName || u.username || u.email;
          }
        }
      } catch { /* ignore */ }
    }
  }

  // 4. Fetch attachments for these emails
  const { listAttachmentsByEmail } = require('./attachmentRepo');
  const attachmentsByEmail = {};
  await Promise.all(
    emailIds.map(async (eid) => {
      try {
        const atts = await listAttachmentsByEmail(eid);
        attachmentsByEmail[String(eid)] = atts || [];
      } catch {
        attachmentsByEmail[String(eid)] = [];
      }
    })
  );

  // 5. Map into complete InboxItem objects
  return forwards.map((fw) => {
    const rawEid = (fw.emailId && fw.emailId._id) ? fw.emailId._id : fw.emailId;
    const email = emailsById[String(rawEid)] || (typeof fw.emailId === 'object' ? fw.emailId : {}) || {};
    const atts = attachmentsByEmail[String(rawEid)] || [];

    const fromName = email.fromName || (email.from?.name) || '';
    const fromAddress = email.fromAddress || (email.from?.email) || '';
    const from = email.from || { name: fromName || fromAddress, email: fromAddress };

    const formattedEmail = {
      _id: String(email._id || rawEid || fw._id),
      id: String(email._id || rawEid || fw._id),
      accountId: String(email.accountId || ''),
      providerId: String(email.providerMessageId || email.providerId || ''),
      subject: email.subject || '(No subject)',
      from,
      fromName,
      fromAddress,
      receivedAt: email.receivedAt ? new Date(email.receivedAt).toISOString() : new Date(fw.createdAt).toISOString(),
      snippetText: email.snippetText || email.bodyPreview || (email.bodyText ? email.bodyText.slice(0, 150) : ''),
      bodyText: email.bodyText || '',
      bodyHtml: email.bodyHtml || '',
      links: email.links || [],
      attachments: atts,
      hasAttachments: Boolean(email.hasAttachments || atts.length > 0),
      isForwarded: true,
      provider: email.provider || 'MICROSOFT',
    };

    const forwarderIdStr = String(fw.forwardedBy || '');
    const forwardedByName = forwarderNames[forwarderIdStr] || 'Project Manager';

    return {
      _id: String(fw._id),
      id: String(fw._id),
      forwardingId: String(fw._id),
      emailId: String(rawEid),
      recipientId: String(fw.recipientId),
      forwardedTo: String(fw.recipientId),
      forwardedBy: forwarderIdStr,
      forwardedByName,
      forwardedAt: fw.createdAt ? new Date(fw.createdAt).toISOString() : new Date().toISOString(),
      note: fw.note || '',
      readAt: fw.readAt ? new Date(fw.readAt).toISOString() : null,
      isRead: Boolean(fw.isRead),
      createdAt: fw.createdAt ? new Date(fw.createdAt).toISOString() : new Date().toISOString(),
      // Embedded full email for direct rendering
      email: formattedEmail,
      attachments: atts,
    };
  });
}

/**
 * Get a single forwarded email item for an employee.
 */
async function getMailboxItem(recipientId, targetId) {
  const recipientIds = [recipientId];
  if (typeof recipientId === 'string' && mongoose.Types.ObjectId.isValid(recipientId)) {
    recipientIds.push(new mongoose.Types.ObjectId(recipientId));
  } else if (recipientId && recipientId.toString) {
    recipientIds.push(recipientId.toString());
  }

  const targetIds = [targetId];
  if (typeof targetId === 'string' && mongoose.Types.ObjectId.isValid(targetId)) {
    targetIds.push(new mongoose.Types.ObjectId(targetId));
  } else if (targetId && targetId.toString) {
    targetIds.push(targetId.toString());
  }

  const fw = await EmailForward.findOne({
    recipientId: { $in: recipientIds },
    $or: [
      { _id: { $in: targetIds } },
      { emailId: { $in: targetIds } },
    ],
  }).lean();

  if (!fw) return null;

  const rawEid = (fw.emailId && fw.emailId._id) ? fw.emailId._id : fw.emailId;
  const emailIds = [rawEid];
  if (typeof rawEid === 'string' && mongoose.Types.ObjectId.isValid(rawEid)) {
    emailIds.push(new mongoose.Types.ObjectId(rawEid));
  }

  const email = await Email.findOne({ _id: { $in: emailIds } }).lean() || {};
  const { listAttachmentsByEmail } = require('./attachmentRepo');
  const attachments = await listAttachmentsByEmail(email._id || rawEid);

  // Forwarder name
  let forwardedByName = 'Project Manager';
  try {
    const AdminModel = mongoose.models.Admin || require('../../../../models/Admin');
    const UserModel = mongoose.models.User || require('../../../../models/User');
    const adminDoc = await AdminModel.findById(fw.forwardedBy).select('username displayName').lean().catch(() => null);
    if (adminDoc) {
      forwardedByName = adminDoc.displayName || adminDoc.username;
    } else {
      const userDoc = await UserModel.findById(fw.forwardedBy).select('username displayName').lean().catch(() => null);
      if (userDoc) forwardedByName = userDoc.displayName || userDoc.username;
    }
  } catch {
    try {
      if (mongoose.connection && mongoose.connection.db) {
        const adminDoc = await mongoose.connection.db.collection('admins').findOne({ _id: new mongoose.Types.ObjectId(String(fw.forwardedBy)) }).catch(() => null);
        if (adminDoc) {
          forwardedByName = adminDoc.displayName || adminDoc.username;
        } else {
          const userDoc = await mongoose.connection.db.collection('users').findOne({ _id: new mongoose.Types.ObjectId(String(fw.forwardedBy)) }).catch(() => null);
          if (userDoc) forwardedByName = userDoc.displayName || userDoc.username;
        }
      }
    } catch { /* ignore */ }
  }

  const fromName = email.fromName || (email.from?.name) || '';
  const fromAddress = email.fromAddress || (email.from?.email) || '';
  const from = email.from || { name: fromName || fromAddress, email: fromAddress };

  const formattedEmail = {
    _id: String(email._id || rawEid || fw._id),
    id: String(email._id || rawEid || fw._id),
    accountId: String(email.accountId || ''),
    providerId: String(email.providerMessageId || email.providerId || ''),
    subject: email.subject || '(No subject)',
    from,
    fromName,
    fromAddress,
    receivedAt: email.receivedAt ? new Date(email.receivedAt).toISOString() : new Date(fw.createdAt).toISOString(),
    snippetText: email.snippetText || email.bodyPreview || (email.bodyText ? email.bodyText.slice(0, 150) : ''),
    bodyText: email.bodyText || '',
    bodyHtml: email.bodyHtml || '',
    links: email.links || [],
    attachments,
    hasAttachments: Boolean(email.hasAttachments || attachments.length > 0),
    isForwarded: true,
    provider: email.provider || 'MICROSOFT',
  };

  return {
    _id: String(fw._id),
    id: String(fw._id),
    forwardingId: String(fw._id),
    emailId: String(email._id || rawEid),
    recipientId: String(fw.recipientId),
    forwardedTo: String(fw.recipientId),
    forwardedBy: String(fw.forwardedBy),
    forwardedByName,
    forwardedAt: fw.createdAt ? new Date(fw.createdAt).toISOString() : new Date().toISOString(),
    note: fw.note || '',
    readAt: fw.readAt ? new Date(fw.readAt).toISOString() : null,
    isRead: Boolean(fw.isRead),
    createdAt: fw.createdAt ? new Date(fw.createdAt).toISOString() : new Date().toISOString(),
    email: formattedEmail,
    attachments,
  };
}

/**
 * Mark a forwarded email as read for an employee.
 */
async function markAsRead(recipientId, targetId) {
  const recipientIds = [recipientId];
  if (typeof recipientId === 'string' && mongoose.Types.ObjectId.isValid(recipientId)) {
    recipientIds.push(new mongoose.Types.ObjectId(recipientId));
  } else if (recipientId && recipientId.toString) {
    recipientIds.push(recipientId.toString());
  }

  const targetIds = [targetId];
  if (typeof targetId === 'string' && mongoose.Types.ObjectId.isValid(targetId)) {
    targetIds.push(new mongoose.Types.ObjectId(targetId));
  } else if (targetId && targetId.toString) {
    targetIds.push(targetId.toString());
  }

  return EmailForward.findOneAndUpdate(
    {
      recipientId: { $in: recipientIds },
      $or: [
        { _id: { $in: targetIds } },
        { emailId: { $in: targetIds } },
      ],
    },
    { isRead: true, readAt: new Date() },
    { new: true }
  );
}

/**
 * Count unread emails for an employee's badge counter.
 */
async function countUnread(recipientId) {
  const recipientIds = [recipientId];
  if (typeof recipientId === 'string' && mongoose.Types.ObjectId.isValid(recipientId)) {
    recipientIds.push(new mongoose.Types.ObjectId(recipientId));
  } else if (recipientId && recipientId.toString) {
    recipientIds.push(recipientId.toString());
  }
  return EmailForward.countDocuments({ recipientId: { $in: recipientIds }, isRead: false });
}

/**
 * List employees/detailers available for PM assignment.
 * Queries Mongoose User model or native users collection directly.
 * Scoped by adminId for multi-tenant isolation.
 */
async function listEmployees(adminId = null) {
  const query = {
    $or: [
      { role: { $in: ['team_member', 'user', 'team_lead', 'project_manager', 'employee', 'detailer'] } },
      { roles: { $in: ['team_member', 'user', 'team_lead', 'project_manager', 'employee', 'detailer'] } },
    ],
  };

  // Multi-tenant scoping: only show users in the same organization
  if (adminId) {
    query.$and = [
      {
        $or: [
          { adminId: adminId },
          { createdByAdminId: adminId },
        ],
      },
    ];
  }

  try {
    const UserModel = mongoose.models.User || (mongoose.modelNames().includes('User') ? mongoose.model('User') : null);
    if (UserModel) {
      const users = await UserModel.find(query).select('_id username name email role').lean();
      return users.map((u) => ({
        id: String(u._id),
        name: u.username || u.name || u.email,
        email: u.email,
        role: u.role || 'team_member',
      }));
    }
  } catch (_e) {
    // ignore and try collection fallback
  }

  try {
    if (mongoose.connection && mongoose.connection.db) {
      const users = await mongoose.connection.db.collection('users').find(query).toArray();
      return users.map((u) => ({
        id: String(u._id),
        name: u.username || u.name || u.email,
        email: u.email,
        role: u.role || 'team_member',
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
