"use strict";
// src/lib/mail/account-service.ts
// -----------------------------------------------------------------------------
// Mail Account Management & Provider Detection.
// -----------------------------------------------------------------------------
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectMailProviderByEmail = detectMailProviderByEmail;
exports.suggestProviderByEmail = suggestProviderByEmail;
exports.listActiveMailAccounts = listActiveMailAccounts;
exports.listMailAccountsByUser = listMailAccountsByUser;
exports.getMailAccountById = getMailAccountById;
exports.getMailAccountByEmail = getMailAccountByEmail;
exports.upsertMailAccount = upsertMailAccount;
exports.getMailAccountForUserAndProvider = getMailAccountForUserAndProvider;
exports.deleteMailAccount = deleteMailAccount;
exports.updateAccountSyncStatus = updateAccountSyncStatus;
exports.updateMailAccountTokens = updateMailAccountTokens;
const promises_1 = __importDefault(require("dns/promises"));
const db_1 = require("../../db");
/**
 * Authoritatively detect the mail provider associated with a work email.
 *
 * Rules:
 * 1. NEVER guess provider based on TLD (.in does NOT mean Zoho, .com does NOT mean Microsoft).
 * 2. Uses DNS MX record resolution to find the actual mail exchangers handling mail for the domain.
 * 3. Falls back to Microsoft User Realm discovery API if MX records are proxied or indeterminate.
 */
async function detectMailProviderByEmail(email) {
    const parts = email.trim().toLowerCase().split('@');
    if (parts.length !== 2)
        return null;
    const domain = parts[1];
    // 1. Inspect DNS MX records
    try {
        const mxRecords = await promises_1.default.resolveMx(domain);
        if (mxRecords && mxRecords.length > 0) {
            for (const record of mxRecords) {
                const exchange = record.exchange.toLowerCase();
                if (exchange.includes('protection.outlook') ||
                    exchange.includes('outlook.com') ||
                    exchange.includes('microsoft.com')) {
                    return 'MICROSOFT';
                }
                if (exchange.includes('zoho.com') ||
                    exchange.includes('zoho.in') ||
                    exchange.includes('zoho.eu') ||
                    exchange.includes('zohomail') ||
                    exchange.includes('.zoho.')) {
                    return 'ZOHO';
                }
            }
        }
    }
    catch (_dnsErr) {
        // DNS resolution failed or unavailable (e.g., test environment, intranet)
    }
    // 2. Microsoft User Realm API (public discovery for Entra / Office 365 domains)
    try {
        const res = await fetch(`https://login.microsoftonline.com/common/userrealm/${encodeURIComponent(email)}?api-version=2.1`, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
            const data = (await res.json());
            if (data.NameSpaceType === 'Managed' || data.NameSpaceType === 'Federated') {
                return 'MICROSOFT';
            }
        }
    }
    catch (_realmErr) {
        // Realm lookup timed out or failed
    }
    // 3. Fallback for well-known native domains (e.g. outlook.com, hotmail.com, zoho.com)
    if (domain === 'outlook.com' ||
        domain === 'hotmail.com' ||
        domain === 'live.com' ||
        domain === 'office365.com' ||
        domain === 'microsoft.com') {
        return 'MICROSOFT';
    }
    if (domain === 'zohomail.com' || domain === 'zoho.com' || domain === 'zoho.in') {
        return 'ZOHO';
    }
    return null;
}
/**
 * Synchronous provider suggestion (kept for backwards compatibility; calls
 * keyword matching on native domains only). Use detectMailProviderByEmail()
 * for actual authentication/connection flows.
 */
function suggestProviderByEmail(email) {
    const parts = email.trim().toLowerCase().split('@');
    if (parts.length !== 2)
        return null;
    const domain = parts[1];
    if (domain === 'outlook.com' ||
        domain === 'hotmail.com' ||
        domain === 'live.com' ||
        domain === 'office365.com' ||
        domain === 'microsoft.com') {
        return 'MICROSOFT';
    }
    if (domain === 'zohomail.com' || domain === 'zoho.com' || domain === 'zoho.in') {
        return 'ZOHO';
    }
    return null;
}
function mapAccountRow(row) {
    return {
        id: row.id,
        userId: row.user_id || null,
        email: row.email,
        provider: row.provider,
        providerUserId: row.provider_user_id,
        displayName: row.display_name || null,
        accessToken: row.access_token || null,
        refreshToken: row.refresh_token || null,
        tokenExpiresAt: row.token_expires_at ? row.token_expires_at.toISOString() : null,
        providerMetadata: row.provider_metadata || {},
        isActive: Boolean(row.is_active),
        lastSyncAt: row.last_sync_at ? row.last_sync_at.toISOString() : null,
        lastSyncStatus: row.last_sync_status || null,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
    };
}
/**
 * List all active mail accounts to be synchronized.
 */
async function listActiveMailAccounts() {
    const { rows } = await (0, db_1.query)(`SELECT * FROM mail_accounts WHERE is_active = TRUE ORDER BY created_at ASC`);
    return rows.map(mapAccountRow);
}
/**
 * List all active mail accounts for a specific user.
 */
async function listMailAccountsByUser(userId) {
    const { rows } = await (0, db_1.query)(`SELECT * FROM mail_accounts WHERE user_id = $1 AND is_active = TRUE ORDER BY created_at ASC`, [userId]);
    return rows.map(mapAccountRow);
}
/**
 * Get a mail account by ID.
 */
async function getMailAccountById(id) {
    const { rows } = await (0, db_1.query)(`SELECT * FROM mail_accounts WHERE id = $1`, [id]);
    return rows[0] ? mapAccountRow(rows[0]) : null;
}
/**
 * Get a mail account by email address.
 */
async function getMailAccountByEmail(email) {
    const { rows } = await (0, db_1.query)(`SELECT * FROM mail_accounts WHERE LOWER(email) = LOWER($1)`, [email]);
    return rows[0] ? mapAccountRow(rows[0]) : null;
}
/**
 * Upsert a mail account for a specific user and provider.
 * Enforces per-user uniqueness by provider (max 1 mailbox per provider per user).
 */
async function upsertMailAccount(account) {
    const { rows } = await (0, db_1.query)(`INSERT INTO mail_accounts
       (user_id, email, provider, provider_user_id, display_name,
        access_token, refresh_token, token_expires_at, provider_metadata, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (user_id, provider) DO UPDATE
       SET email             = EXCLUDED.email,
           provider_user_id  = EXCLUDED.provider_user_id,
           display_name      = COALESCE(EXCLUDED.display_name, mail_accounts.display_name),
           access_token      = COALESCE(EXCLUDED.access_token, mail_accounts.access_token),
           refresh_token     = COALESCE(EXCLUDED.refresh_token, mail_accounts.refresh_token),
           token_expires_at  = COALESCE(EXCLUDED.token_expires_at, mail_accounts.token_expires_at),
           provider_metadata = COALESCE(EXCLUDED.provider_metadata, mail_accounts.provider_metadata),
           is_active         = COALESCE(EXCLUDED.is_active, mail_accounts.is_active),
           updated_at        = now()
     RETURNING *`, [
        account.userId,
        account.email,
        account.provider,
        account.providerUserId,
        account.displayName || null,
        account.accessToken || null,
        account.refreshToken || null,
        account.tokenExpiresAt || null,
        JSON.stringify(account.providerMetadata || {}),
        account.isActive !== undefined ? account.isActive : true,
    ]);
    return mapAccountRow(rows[0]);
}
/**
 * Get a mail account for a specific user and provider.
 */
async function getMailAccountForUserAndProvider(userId, provider) {
    const { rows } = await (0, db_1.query)(`SELECT * FROM mail_accounts WHERE user_id = $1 AND provider = $2 AND is_active = TRUE LIMIT 1`, [userId, provider]);
    return rows[0] ? mapAccountRow(rows[0]) : null;
}
/**
 * Delete / Disconnect a mail account, verifying that it belongs to the authenticated user.
 */
async function deleteMailAccount(accountId, userId) {
    const { rowCount } = await (0, db_1.query)(`DELETE FROM mail_accounts WHERE id = $1 AND user_id = $2`, [accountId, userId]);
    return (rowCount ?? 0) > 0;
}
/**
 * Update the last sync status and timestamp for a mail account.
 */
async function updateAccountSyncStatus(accountId, status) {
    await (0, db_1.query)(`UPDATE mail_accounts
        SET last_sync_at = now(),
            last_sync_status = $1,
            updated_at = now()
      WHERE id = $2`, [status, accountId]);
}
/**
 * Update access and refresh tokens for a mail account.
 */
async function updateMailAccountTokens(accountId, accessToken, tokenExpiresAt, refreshToken) {
    if (refreshToken !== undefined && refreshToken !== null) {
        await (0, db_1.query)(`UPDATE mail_accounts
          SET access_token     = $1,
              token_expires_at = $2,
              refresh_token    = $3,
              updated_at       = now()
        WHERE id = $4`, [accessToken, tokenExpiresAt, refreshToken, accountId]);
    }
    else {
        await (0, db_1.query)(`UPDATE mail_accounts
          SET access_token     = $1,
              token_expires_at = $2,
              updated_at       = now()
        WHERE id = $3`, [accessToken, tokenExpiresAt, accountId]);
    }
}
