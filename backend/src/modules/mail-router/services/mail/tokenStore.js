"use strict";
// src/features/mail-router/auth/tokenStore.ts
// -----------------------------------------------------------------------------
// Persists the PM's MSAL token cache in the database so it survives server
// restarts and can be used by background sync jobs.
//
// The token cache is stored as the ms_token_cache column on mail_router_user_refs.
// In a production system, consider encrypting this column at rest (e.g. with
// pgcrypto's pgp_sym_encrypt) before storing credentials in the database.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadTokenCache = loadTokenCache;
exports.saveTokenCache = saveTokenCache;
exports.saveMsProfile = saveMsProfile;
exports.clearMsProfile = clearMsProfile;
exports.getValidAccessToken = getValidAccessToken;
const db_1 = require("../../db");
const msalProvider_1 = require("./msalProvider");
/**
 * Load the serialised MSAL token cache for a user from the database.
 * Returns null if no cache has been stored yet (user has not authenticated).
 */
async function loadTokenCache(userId) {
    const { rows } = await (0, db_1.query)('SELECT ms_token_cache FROM mail_router_user_refs WHERE id = $1', [userId]);
    return rows[0]?.ms_token_cache ?? null;
}
/**
 * Persist an updated serialised MSAL token cache for a user.
 * Called after every token acquisition so the cache stays current.
 */
async function saveTokenCache(userId, serialisedCache) {
    await (0, db_1.query)(`UPDATE mail_router_user_refs
        SET ms_token_cache = $1, updated_at = now()
      WHERE id = $2`, [serialisedCache, userId]);
}
/**
 * Store the PM's Microsoft tenant ID and UPN after their first successful login.
 * Used to identify which Graph endpoint to call for background syncs.
 */
async function saveMsProfile(userId, tenantId, upn, serialisedCache) {
    await (0, db_1.query)(`UPDATE mail_router_user_refs
        SET ms_tenant_id   = $1,
            ms_upn         = $2,
            ms_token_cache = $3,
            updated_at     = now()
      WHERE id = $4`, [tenantId, upn, serialisedCache, userId]);
}
async function clearMsProfile(userId) {
    await (0, db_1.query)(`UPDATE mail_router_user_refs
        SET ms_tenant_id   = NULL,
            ms_upn         = NULL,
            ms_token_cache = NULL,
            updated_at     = now()
      WHERE id = $1`, [userId]);
}
/**
 * Get a valid access token for a PM, refreshing silently if needed.
 * Always call this before making a Graph request from a service.
 *
 * @throws If the user has not authenticated or the token cannot be refreshed.
 */
async function getValidAccessToken(userId, sessionAccountId) {
    const serialisedCache = await loadTokenCache(userId);
    if (!serialisedCache) {
        throw new Error(`[mail-router:tokenStore] No token cache for user ${userId}. ` +
            'User must authenticate with Microsoft first.');
    }
    const { accessToken, serialisedCache: updatedCache } = await (0, msalProvider_1.acquireTokenSilent)(sessionAccountId, serialisedCache);
    // Persist the refreshed cache (MSAL may have silently obtained a new RT)
    await saveTokenCache(userId, updatedCache);
    return accessToken;
}
