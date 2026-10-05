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
async function createForwarding(emailId, forwardedBy, recipientIds, note, projectId = null, projectName = '') {
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

  for (const recipientId of actualRecipientIds) {
    const doc = await EmailForward.findOneAndUpdate(
      { emailId, recipientId },
      {
        emailId,
        recipientId,
        forwardedBy: actualForwardedBy,
        note: note || '',
        projectId: projectId || null,
        projectName: projectName || '',
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

  // Update email triage status to FORWARDED and set isForwarded flag
  await Email.findByIdAndUpdate(emailId, { triageStatus: 'FORWARDED', isForwarded: true });

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
      projectId: fw.projectId ? String(fw.projectId) : null,
      projectName: fw.projectName || '',
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
  const Attachment = require('../models/Attachment');
  const { resolveInlineImages } = require('../services/inlineImageService');

  const [attachments, fullAttachments] = await Promise.all([
    listAttachmentsByEmail(email._id || rawEid),
    Attachment.find({ emailId: { $in: emailIds } }).lean(),
  ]);

  const { html: resolvedHtml, inlineAttachmentIds } = resolveInlineImages(email.bodyHtml, fullAttachments);

  // If HTML had CIDs resolved, asynchronously cache in DB
  if (resolvedHtml && resolvedHtml !== email.bodyHtml && email._id) {
    Email.updateOne({ _id: email._id }, { bodyHtml: resolvedHtml }).catch(() => {});
  }

  // Filter out inline images from drawing/file attachments so they don't clutter the download tray
  const drawingAttachments = attachments.filter(a =>
    !inlineAttachmentIds.includes(String(a._id || a.id)) && !a.isInline
  );

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
    bodyHtml: resolvedHtml || email.bodyHtml || '',
    links: email.links || [],
    attachments: drawingAttachments,
    hasAttachments: Boolean(drawingAttachments.length > 0),
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
    projectId: fw.projectId ? String(fw.projectId) : null,
    projectName: fw.projectName || '',
    readAt: fw.readAt ? new Date(fw.readAt).toISOString() : null,
    isRead: Boolean(fw.isRead),
    createdAt: fw.createdAt ? new Date(fw.createdAt).toISOString() : new Date().toISOString(),
    email: formattedEmail,
    attachments: drawingAttachments,
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
 * List employees and projects for PM triage & assignment.
 * Scoped by adminId for multi-tenant isolation.
 */
async function listEmployees(adminId = null) {
  const queryAdminIds = [];
  if (adminId) {
    queryAdminIds.push(adminId);
    if (typeof adminId === 'string' && mongoose.Types.ObjectId.isValid(adminId)) {
      queryAdminIds.push(new mongoose.Types.ObjectId(adminId));
    } else if (adminId && adminId.toString) {
      queryAdminIds.push(adminId.toString());
    }
  }

  const ALLOWED_EMPLOYEE_ROLES = [
    'team_member',
    'user',
    'team_lead',
    'project_manager',
    'employee',
    'detailer',
    'pm',
    'tl',
  ];
  const EXCLUDED_ROLES = ['admin', 'superadmin'];

  const userQuery = {
    role: { $in: ALLOWED_EMPLOYEE_ROLES, $nin: EXCLUDED_ROLES },
    status: { $ne: 'inactive' },
  };
  if (queryAdminIds.length > 0) {
    userQuery.$or = [
      { adminId: { $in: queryAdminIds } },
      { createdByAdminId: { $in: queryAdminIds } },
    ];
  }

  let UserModel = mongoose.models.User;
  if (!UserModel) {
    try { UserModel = require('../../../../models/User'); } catch { UserModel = null; }
  }

  let ProjectModel = mongoose.models.Project;
  if (!ProjectModel) {
    try { ProjectModel = require('../../../../models/Project'); } catch { ProjectModel = null; }
  }

  let users = [];
  try {
    if (UserModel) {
      users = await UserModel.find(userQuery).select('_id username displayName name email role adminId status').lean();
    } else if (mongoose.connection && mongoose.connection.db) {
      users = await mongoose.connection.db.collection('users').find(userQuery).toArray();
    }
  } catch (err) {
    console.warn('[forwardingRepo:listEmployees] Error querying users:', err);
  }

  // Filter out any unexpected admin/superadmin accounts
  const validUserMap = new Map();
  for (const u of users) {
    const role = String(u.role || '').toLowerCase();
    if (!EXCLUDED_ROLES.includes(role)) {
      validUserMap.set(String(u._id), u);
    }
  }
  const validUserIds = new Set(validUserMap.keys());

  // Also query projects for this admin
  const projQuery = { status: { $ne: 'archived' } };
  if (queryAdminIds.length > 0) {
    projQuery.createdByAdminId = { $in: queryAdminIds };
  }

  let projects = [];
  try {
    if (ProjectModel) {
      projects = await ProjectModel.find(projQuery).select('_id name clientName status assignments').sort({ name: 1 }).lean();
    } else if (mongoose.connection && mongoose.connection.db) {
      projects = await mongoose.connection.db.collection('projects').find(projQuery).toArray();
    }
  } catch (err) {
    console.warn('[forwardingRepo:listEmployees] Error querying projects:', err);
  }

  // Build mapping of user -> projects (only for valid non-admin users)
  const userProjectsMap = {};
  for (const p of projects) {
    for (const a of (p.assignments || [])) {
      const uid = String(a.userId);
      if (!validUserIds.has(uid)) continue;
      if (!userProjectsMap[uid]) userProjectsMap[uid] = [];
      userProjectsMap[uid].push({
        id: String(p._id),
        name: p.name,
        permission: a.permission || 'viewer',
      });
    }
  }

  const formattedEmployees = users
    .filter((u) => validUserIds.has(String(u._id)))
    .map((u) => {
      const uid = String(u._id);
      const assignedProjects = userProjectsMap[uid] || [];
      return {
        id: uid,
        _id: uid,
        name: u.displayName || u.name || u.username || u.email,
        displayName: u.displayName || u.name || u.username || u.email,
        username: u.username || u.email,
        email: u.email || '',
        role: u.role || 'team_member',
        projectIds: assignedProjects.map((p) => p.id),
        projects: assignedProjects,
      };
    });

  const formattedProjects = projects.map((p) => {
    // Only count assigned users who are in validUserIds (i.e. PMs, TLs, and team members — NOT admin/superadmin)
    const assignedUserIds = Array.from(
      new Set(
        (p.assignments || [])
          .map((a) => String(a.userId))
          .filter((uid) => validUserIds.has(uid))
      )
    );
    return {
      id: String(p._id),
      _id: String(p._id),
      name: p.name,
      clientName: p.clientName || '',
      status: p.status || 'in_progress',
      assignedUserIds,
      memberCount: assignedUserIds.length,
    };
  });

  let TeamModel = mongoose.models.Team;
  if (!TeamModel) {
    try { TeamModel = require('../../../../models/Team'); } catch { TeamModel = null; }
  }

  let teams = [];
  try {
    if (TeamModel) {
      teams = await TeamModel.find({}).lean();
    } else if (mongoose.connection && mongoose.connection.db) {
      teams = await mongoose.connection.db.collection('teams').find({}).toArray();
    }
  } catch (err) {
    console.warn('[forwardingRepo:listEmployees] Error querying teams:', err);
  }

  const formattedTeams = teams.map(t => ({
    id: String(t._id),
    name: t.name,
    lead: String(t.lead),
    members: (t.members || []).map(m => String(m))
  }));

  return {
    employees: formattedEmployees,
    projects: formattedProjects,
    teams: formattedTeams
  };
}

module.exports = {
  createForwarding,
  listMailboxItems,
  getMailboxItem,
  markAsRead,
  countUnread,
  listEmployees,
};
