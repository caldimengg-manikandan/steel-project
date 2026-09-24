"use strict";
// src/lib/mail/providers/microsoft/mail-provider.ts
// -----------------------------------------------------------------------------
// MicrosoftMailProvider — Implements MailProvider interface for Microsoft Graph.
// -----------------------------------------------------------------------------
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.microsoftMailProvider = exports.MicrosoftMailProvider = void 0;
exports.resolveMicrosoftMailboxId = resolveMicrosoftMailboxId;
const auth_1 = require("./auth");
const mail_fetcher_1 = require("./mail-fetcher");
const attachments_1 = require("./attachments");
const account_service_1 = require("../../account-service");
const errors_1 = require("../../errors");
/**
 * Resolves the appropriate Microsoft Graph mailbox identifier based on authentication type.
 *
 * Rules:
 * - Application-only tokens (client credentials) CANNOT use '/me' — Graph returns 400.
 *   They MUST target the user's email or UPN (e.g. '/users/user@domain.com/...').
 * - Delegated user tokens (OAuth Authorization Code) represent the authenticated user,
 *   so '/me' is standard and valid.
 */
function resolveMicrosoftMailboxId(auth, account, requestedMailboxId) {
    if (auth.authType === 'application') {
        // 1. Explicit mailbox requested (and not 'me')
        if (requestedMailboxId && requestedMailboxId !== 'me') {
            return requestedMailboxId;
        }
        // 2. Account email address
        if (account?.email) {
            return account.email;
        }
        // 3. Provider user ID if not 'me'
        if (account?.providerUserId && account.providerUserId !== 'me') {
            return account.providerUserId;
        }
        // 4. Provider metadata UPN
        if (account?.providerMetadata?.upn && typeof account.providerMetadata.upn === 'string') {
            return account.providerMetadata.upn;
        }
        throw new errors_1.MailProviderError({
            provider: 'MICROSOFT',
            code: 'CLIENT_ERROR',
            message: 'Client-credentials authentication is application-only and requires a specific target mailbox email or UPN. The "/me" endpoint is only valid with delegated authentication.',
            retryable: false,
        });
    }
    // Delegated authentication
    if (requestedMailboxId && requestedMailboxId !== 'me') {
        return requestedMailboxId;
    }
    return 'me';
}
class MicrosoftMailProvider {
    constructor() {
        this.providerType = 'MICROSOFT';
    }
    getProviderName() {
        return 'Microsoft 365 / Outlook';
    }
    /**
     * Acquire access token.
     * 1. If account has a valid, unexpired delegated access token, use it.
     * 2. If token is expired and account has MSAL credentials, attempt silent refresh.
     * 3. Otherwise fall back to application-level client credentials token.
     */
    async authenticate(account) {
        if (account?.accessToken && account.tokenExpiresAt) {
            const expiresAt = new Date(account.tokenExpiresAt);
            if (expiresAt.getTime() > Date.now() + 60000) {
                return {
                    accessToken: account.accessToken,
                    expiresAt,
                    authType: 'delegated',
                };
            }
        }
        let delegatedError;
        // Attempt silent refresh via MSAL token cache if user ID and account ID are available
        if (account?.userId) {
            try {
                const homeAccountId = account.providerMetadata?.accountId ||
                    account.refreshToken ||
                    '';
                if (homeAccountId) {
                    const { getValidAccessToken } = await Promise.resolve().then(() => __importStar(require('../../tokenStore')));
                    const freshToken = await getValidAccessToken(account.userId, homeAccountId);
                    const expiresAt = new Date(Date.now() + 3500000);
                    account.accessToken = freshToken;
                    account.tokenExpiresAt = expiresAt.toISOString();
                    const accountId = account.id || account._id;
                    if (accountId) {
                        try {
                            await (0, account_service_1.updateMailAccountTokens)(accountId, freshToken, expiresAt);
                        }
                        catch (dbErr) {
                            console.warn('[microsoft:auth] Could not persist refreshed token to DB:', dbErr);
                        }
                    }
                    return { accessToken: freshToken, expiresAt, authType: 'delegated' };
                }
            }
            catch (silentErr) {
                delegatedError = silentErr instanceof Error ? silentErr.message : String(silentErr);
                console.warn('[microsoft:auth] Silent delegated refresh failed, trying client credentials:', delegatedError);
                // Invalidate stale in-memory delegated token so it is not mistaken for a valid token
                account.accessToken = null;
                // If the user was deleted from Entra directory (AADSTS500341), clean up invalid cache
                if (delegatedError.includes('AADSTS500341') || delegatedError.includes('No cached account found')) {
                    try {
                        const { clearMsProfile } = await Promise.resolve().then(() => __importStar(require('../../tokenStore')));
                        await clearMsProfile(account.userId);
                    }
                    catch {
                        // Best effort cleanup
                    }
                }
            }
        }
        // Fall back to client credentials (application permissions)
        try {
            const token = await (0, auth_1.getGraphAccessToken)();
            return {
                accessToken: token,
                expiresAt: new Date(Date.now() + 3500000),
                authType: 'application',
                delegatedError,
            };
        }
        catch (clientCredErr) {
            // If client credentials fail but we have an unexpired/existing access token, try it
            if (account?.accessToken) {
                return {
                    accessToken: account.accessToken,
                    expiresAt: new Date(Date.now() + 60000),
                    authType: 'delegated',
                };
            }
            const clientCredMsg = clientCredErr instanceof Error ? clientCredErr.message : String(clientCredErr);
            const combinedMsg = delegatedError
                ? `Delegated authentication failed: ${delegatedError}. Client credentials fallback also failed: ${clientCredMsg}`
                : clientCredMsg;
            throw new errors_1.MailProviderError({
                provider: 'MICROSOFT',
                code: 'AUTHENTICATION_REQUIRED',
                message: combinedMsg,
                retryable: false,
            });
        }
    }
    async listMessages(options, account) {
        const auth = await this.authenticate(account);
        const mailboxId = resolveMicrosoftMailboxId(auth, account, options.mailboxId);
        try {
            return await (0, mail_fetcher_1.fetchMessagesPage)(auth.accessToken, { ...options, mailboxId });
        }
        catch (err) {
            if (auth.delegatedError && err instanceof Error) {
                console.warn(`[microsoft:sync] Primary delegated auth failed (${auth.delegatedError}), fallback error: ${err.message}`);
            }
            throw err;
        }
    }
    async getMessage(messageId, account) {
        const auth = await this.authenticate(account);
        const mailboxId = resolveMicrosoftMailboxId(auth, account);
        return (0, mail_fetcher_1.fetchSingleMessage)(auth.accessToken, mailboxId, messageId);
    }
    async listAttachments(messageId, account) {
        const auth = await this.authenticate(account);
        const mailboxId = resolveMicrosoftMailboxId(auth, account);
        return (0, attachments_1.fetchAttachmentList)(auth.accessToken, mailboxId, messageId);
    }
    async downloadAttachment(messageId, attachmentId, account) {
        const auth = await this.authenticate(account);
        const mailboxId = resolveMicrosoftMailboxId(auth, account);
        return (0, attachments_1.downloadAttachmentContent)(auth.accessToken, mailboxId, messageId, attachmentId);
    }
}
exports.MicrosoftMailProvider = MicrosoftMailProvider;
exports.microsoftMailProvider = new MicrosoftMailProvider();
