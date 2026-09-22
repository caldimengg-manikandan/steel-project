// backend-cjs/mongoose/repositories/emailRepo.js
const Email = require('../models/Email');

async function upsertEmail(normalizedMessage, syncJobId, accountId) {
  const filter = { providerMessageId: normalizedMessage.providerMessageId };

  const update = {
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

async function listEmailsInWindow(startDate, endDate, provider, userId) {
  const query = {};

  if (userId) {
    query.userId = userId;
  }

  if (provider) {
    query.provider = provider;
  }

  if (startDate || endDate) {
    query.receivedAt = {};
    if (startDate) {
      query.receivedAt.$gte = new Date(`${startDate}T00:00:00.000Z`);
    }
    if (endDate) {
      query.receivedAt.$lte = new Date(`${endDate}T23:59:59.999Z`);
    }
  }

  return Email.find(query).sort({ receivedAt: -1 }).lean();
}

module.exports = {
  upsertEmail,
  getEmailById,
  listEmailsInWindow,
};
