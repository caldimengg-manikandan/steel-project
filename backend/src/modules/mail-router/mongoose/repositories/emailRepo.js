// backend-cjs/mongoose/repositories/emailRepo.js
const Email = require('../models/Email');

async function upsertEmail(normalizedMessage, syncJobId, accountId, userId) {
  const filter = { providerMessageId: normalizedMessage.providerMessageId };

  const update = {
    userId: userId || undefined,
    provider: normalizedMessage.provider,
    providerMessageId: normalizedMessage.providerMessageId,
    mailboxAddress: normalizedMessage.mailboxAddress,
    fromName: normalizedMessage.fromName,
    fromAddress: normalizedMessage.fromAddress,
    subject: normalizedMessage.subject,
    receivedAt: new Date(normalizedMessage.receivedAt),
    bodyPreview: normalizedMessage.bodyPreview,
    bodyText: normalizedMessage.bodyText,
    bodyHtml: normalizedMessage.bodyHtml,
    hasAttachments: Boolean(normalizedMessage.hasAttachments),
    internetMessageId: normalizedMessage.internetMessageId || null,
    links: normalizedMessage.links || [],
    syncJobId: syncJobId || undefined,
    accountId: accountId || undefined,
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

async function listEmailsInWindow(startDate, endDate, provider, userId, limit = 200, offset = 0) {
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

  const hasStart = startDate && startDate !== 'undefined' && startDate !== 'null' && String(startDate).trim() !== '';
  const hasEnd = endDate && endDate !== 'undefined' && endDate !== 'null' && String(endDate).trim() !== '';

  if (hasStart || hasEnd) {
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
      .select('_id userId accountId provider providerMessageId mailboxAddress fromName fromAddress subject receivedAt bodyPreview hasAttachments triageStatus isForwarded projectId createdAt')
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
