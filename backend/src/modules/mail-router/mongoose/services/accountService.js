// backend-cjs/mongoose/services/accountService.js
const MailAccount = require('../models/MailAccount');

async function listMailAccountsByUser(userId) {
  return MailAccount.find({ userId }).lean();
}

async function getMailAccountById(id) {
  return MailAccount.findById(id).lean();
}

async function getMailAccountForUserAndProvider(userId, provider) {
  return MailAccount.findOne({ userId, provider }).lean();
}

async function setActiveMailAccountForUser(userId, accountIdOrProvider) {
  // 1. Mark all mail accounts for this user as inactive for autosync
  await MailAccount.updateMany({ userId }, { $set: { isActive: false } });

  // 2. Activate only the specified mailbox
  const filter = { userId };
  if (
    typeof accountIdOrProvider === 'string' &&
    accountIdOrProvider.length === 24 &&
    /^[0-9a-fA-F]{24}$/.test(accountIdOrProvider)
  ) {
    filter._id = accountIdOrProvider;
  } else {
    filter.provider = accountIdOrProvider;
  }

  const updated = await MailAccount.findOneAndUpdate(filter, { $set: { isActive: true } }, { new: true });
  return updated;
}

async function upsertMailAccount(accountData) {
  // Make previously connected accounts inactive so the newly connected one is the single active mailbox
  await MailAccount.updateMany(
    { userId: accountData.userId, provider: { $ne: accountData.provider } },
    { $set: { isActive: false } }
  );

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
  setActiveMailAccountForUser,
  upsertMailAccount,
  deleteMailAccount,
  updateAccountSyncStatus,
  updateMailAccountTokens,
};
