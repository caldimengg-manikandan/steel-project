// backend-cjs/mongoose/services/tokenStore.js
const MailUserToken = require('../models/MailUserToken');
const { acquireTokenSilent } = require('../../services/mail/msalProvider');

async function loadTokenCache(userId) {
  const record = await MailUserToken.findOne({ userId }).lean();
  return record?.msTokenCache || null;
}

async function saveTokenCache(userId, serialisedCache) {
  return MailUserToken.findOneAndUpdate(
    { userId },
    { msTokenCache: serialisedCache },
    { upsert: true, new: true }
  );
}

async function saveMsProfile(userId, tenantId, upn, serialisedCache) {
  return MailUserToken.findOneAndUpdate(
    { userId },
    {
      msTenantId: tenantId,
      msUpn: upn,
      msTokenCache: serialisedCache,
    },
    { upsert: true, new: true }
  );
}

async function clearMsProfile(userId) {
  return MailUserToken.findOneAndUpdate(
    { userId },
    {
      msTenantId: null,
      msUpn: null,
      msTokenCache: null,
    }
  );
}

async function getValidAccessToken(userId, sessionAccountId) {
  const serialisedCache = await loadTokenCache(userId);
  if (!serialisedCache) {
    throw new Error(
      `[mail-router:tokenStore] No token cache for user ${userId}. User must authenticate with Microsoft first.`
    );
  }

  const { accessToken, serialisedCache: updatedCache } = await acquireTokenSilent(
    sessionAccountId,
    serialisedCache
  );

  await saveTokenCache(userId, updatedCache);
  return accessToken;
}

module.exports = {
  loadTokenCache,
  saveTokenCache,
  saveMsProfile,
  clearMsProfile,
  getValidAccessToken,
};
