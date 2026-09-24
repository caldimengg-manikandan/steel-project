// backend-cjs/mongoose/services/accountService.js
const MailAccount = require('../models/MailAccount');

async function listMailAccountsByUser(userId) {
  return MailAccount.find({ userId, isActive: true }).lean();
}

async function getMailAccountById(id) {
  return MailAccount.findById(id).lean();
}

async function getMailAccountForUserAndProvider(userId, provider) {
  return MailAccount.findOne({ userId, provider, isActive: true }).lean();
}

async function upsertMailAccount(accountData) {
  const filter = {
    userId: accountData.userId,
    provider: accountData.provider,
  };

  const update = {
    email: accountData.email,
    providerUserId: accountData.providerUserId || 'me',
    displayName: accountData.displayName || `Mailbox (${accountData.email})`,
    accessToken: accountData.accessToken,
    refreshToken: accountData.refreshToken || undefined,
    tokenExpiresAt: accountData.tokenExpiresAt ? new Date(accountData.tokenExpiresAt) : undefined,
    providerMetadata: accountData.providerMetadata || {},
    isActive: true,
  };

  return MailAccount.findOneAndUpdate(filter, update, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true,
  });
}

async function deleteMailAccount(accountId, userId) {
  const res = await MailAccount.deleteOne({ _id: accountId, userId });
  return res.deletedCount > 0;
}

async function updateAccountSyncStatus(accountId, status) {
  return MailAccount.findByIdAndUpdate(accountId, {
    lastSyncAt: new Date(),
    lastSyncStatus: status,
  });
}

async function updateMailAccountTokens(accountId, accessToken, expiresAt, refreshToken) {
  const update = {
    accessToken,
    tokenExpiresAt: expiresAt,
  };
  if (refreshToken) {
    update.refreshToken = refreshToken;
  }
  return MailAccount.findByIdAndUpdate(accountId, update, { new: true });
}

module.exports = {
  listMailAccountsByUser,
  getMailAccountById,
  getMailAccountForUserAndProvider,
  upsertMailAccount,
  deleteMailAccount,
  updateAccountSyncStatus,
  updateMailAccountTokens,
};
