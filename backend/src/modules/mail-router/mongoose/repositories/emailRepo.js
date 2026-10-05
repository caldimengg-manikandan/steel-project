// backend-cjs/mongoose/repositories/emailRepo.js
const Email = require('../models/Email');

async function upsertEmail(normalizedMessage, syncJobId, accountId, userId, folder, remoteFolderId) {
  const filter = { providerMessageId: normalizedMessage.providerMessageId };

  const targetFolder = normalizedMessage.folder || (folder ? String(folder).toLowerCase() : 'inbox');
  const isSpam = targetFolder === 'spam' || Boolean(normalizedMessage.isSpam);

  // If the existing email already has its inline images resolved into base64 data URIs,
  // preserve the resolved bodyHtml so background autosync doesn't overwrite it with raw unauthenticated remote URLs
  const existing = await Email.findOne(filter).select('_id bodyHtml').lean();
  let finalBodyHtml = normalizedMessage.bodyHtml;
  if (existing && existing.bodyHtml && existing.bodyHtml.includes('data:image/')) {
    if (normalizedMessage.bodyHtml && (normalizedMessage.bodyHtml.includes('cid:') || normalizedMessage.bodyHtml.includes('ImageDisplay'))) {
      finalBodyHtml = existing.bodyHtml;
    }
  }

  const update = {
    userId: userId || undefined,
    provider: normalizedMessage.provider,
    providerMessageId: normalizedMessage.providerMessageId,
    mailboxAddress: normalizedMessage.mailboxAddress,
    fromName: normalizedMessage.fromName,
    fromAddress: normalizedMessage.fromAddress,
    toName: normalizedMessage.toName || undefined,
    toAddress: normalizedMessage.toAddress || undefined,
    subject: normalizedMessage.subject,
    receivedAt: new Date(normalizedMessage.receivedAt),
    bodyPreview: normalizedMessage.bodyPreview,
    bodyText: normalizedMessage.bodyText,
    bodyHtml: finalBodyHtml,
    hasAttachments: Boolean(normalizedMessage.hasAttachments),
    internetMessageId: normalizedMessage.internetMessageId || null,
    links: normalizedMessage.links || [],
    syncJobId: syncJobId || undefined,
    accountId: accountId || undefined,
    folder: targetFolder,
    remoteFolderId: remoteFolderId || normalizedMessage.remoteFolderId || undefined,
    isSpam,
  };

  const doc = await Email.findOneAndUpdate(filter, update, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  });

  return doc;
}

async function getEmailById(id) {
  return Email.findById(id).lean();
}

async function listEmailsInWindow(startDate, endDate, provider, userId, limit = 200, offset = 0, folder = null) {
  const andConditions = [];

  if (userId) {
    const MailAccount = require('../models/MailAccount');
    const userAccounts = await MailAccount.find({ userId }).select('_id').lean();
    const accountIds = userAccounts.map(a => a._id);
    andConditions.push({
      $or: [
        { userId },
        { accountId: { $in: accountIds } },
        { accountId: { $in: accountIds.map(String) } }
      ]
    });
  }

  if (provider) {
    andConditions.push({ provider: provider.toUpperCase() });
  }

  const cleanFolder = folder ? String(folder).toLowerCase() : null;
  if (cleanFolder) {
    if (cleanFolder === 'sent') {
      andConditions.push({ folder: 'sent' });
    } else if (cleanFolder === 'spam') {
      andConditions.push({
        $or: [
          { folder: 'spam' },
          { isSpam: true },
        ],
      });
    } else if (cleanFolder === 'history') {
      andConditions.push({
        $or: [
          { isForwarded: true },
          { triageStatus: 'FORWARDED' },
        ],
      });
    } else if (cleanFolder === 'drafts' || cleanFolder === 'draft') {
      andConditions.push({
        folder: { $in: ['drafts', 'draft'] },
      });
    } else if (cleanFolder === 'outbox') {
      andConditions.push({
        folder: 'outbox',
      });
    } else if (cleanFolder === 'inbox') {
      const MailFolder = require('../models/MailFolder');
      const customFolders = await MailFolder.find({}).select('folderId').lean();
      const customFolderSlugs = (customFolders || []).map(c => c.folderId);
      andConditions.push({
        folder: { $nin: ['sent', 'spam', 'trash', 'drafts', 'draft', 'outbox', 'archive', ...customFolderSlugs] },
        isSpam: { $ne: true },
      });
    } else {
      // Custom user/provider folder
      andConditions.push({ folder: cleanFolder });
    }
  }

  const hasStart = startDate && startDate !== 'undefined' && startDate !== 'null' && String(startDate).trim() !== '';
  const hasEnd = endDate && endDate !== 'undefined' && endDate !== 'null' && String(endDate).trim() !== '';

  // Spam, History, Drafts, and Outbox reflect all pertinent messages; do not restrict by date window
  if ((hasStart || hasEnd) && cleanFolder !== 'spam' && cleanFolder !== 'history' && cleanFolder !== 'drafts' && cleanFolder !== 'outbox') {
    const dateRange = {};
    if (hasStart) {
      dateRange.$gte = new Date(`${String(startDate).trim()}T00:00:00.000Z`);
    }
    if (hasEnd) {
      dateRange.$lte = new Date(`${String(endDate).trim()}T23:59:59.999Z`);
    }
    andConditions.push({ receivedAt: dateRange });
  }

  const query = andConditions.length > 0 ? { $and: andConditions } : {};

  // High-performance projection: Exclude massive bodyHtml/bodyText. Keep bodyPreview for card snippets.
  const [emails, total] = await Promise.all([
    Email.find(query)
      .select('_id userId accountId provider providerMessageId mailboxAddress fromName fromAddress toName toAddress subject receivedAt bodyPreview hasAttachments triageStatus isForwarded folder isSpam projectId createdAt')
      .sort({ receivedAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean(),
    Email.countDocuments(query),
  ]);

  return { emails, total };
}

async function updateEmailBodyHtml(id, bodyHtml) {
  return Email.findByIdAndUpdate(id, { bodyHtml }, { new: true });
}

module.exports = {
  upsertEmail,
  getEmailById,
  listEmailsInWindow,
  updateEmailBodyHtml,
};
