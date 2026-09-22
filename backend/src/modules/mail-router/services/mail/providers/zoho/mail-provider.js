"use strict";
// src/lib/mail/providers/zoho/mail-provider.ts
// -----------------------------------------------------------------------------
// ZohoMailProvider — Implements MailProvider interface for Zoho Mail API.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.zohoMailProvider = exports.ZohoMailProvider = void 0;
const auth_1 = require("./auth");
const mail_fetcher_1 = require("./mail-fetcher");
const attachments_1 = require("./attachments");
const zoho_client_1 = require("./zoho-client");
const errors_1 = require("../../errors");
const account_service_1 = require("../../account-service");
class ZohoMailProvider {
    constructor() {
        this.providerType = 'ZOHO';
    }
    getProviderName() {
        return 'Zoho Mail';
    }
    async authenticate(account) {
        if (!account) {
            throw new errors_1.MailProviderError({
                provider: 'ZOHO',
                code: 'ACCOUNT_REQUIRED',
                message: 'A valid Zoho MailAccount is required for authentication.',
                retryable: false,
            });
        }
        // Check if the current token is still valid (at least 60s remaining)
        if (account.accessToken && account.tokenExpiresAt) {
            const expiresAt = new Date(account.tokenExpiresAt);
            if (expiresAt.getTime() > Date.now() + 60000) {
                return {
                    accessToken: account.accessToken,
                    expiresAt,
                };
            }
        }
        // Refresh if refresh_token is present
        if (account.refreshToken) {
            const customAccountsUrl = account.providerMetadata?.accountsUrl || undefined;
            const refreshResult = await (0, auth_1.refreshZohoAccessToken)(account.refreshToken, customAccountsUrl);
            account.accessToken = refreshResult.accessToken;
            account.tokenExpiresAt = refreshResult.expiresAt.toISOString();
            if (account.id) {
                try {
                    await (0, account_service_1.updateMailAccountTokens)(account.id, refreshResult.accessToken, refreshResult.expiresAt);
                }
                catch (dbErr) {
                    console.warn('[zoho:mail-provider] Could not persist refreshed token to DB:', dbErr);
                }
            }
            return refreshResult;
        }
        if (account.accessToken) {
            return { accessToken: account.accessToken };
        }
        throw new errors_1.MailProviderError({
            provider: 'ZOHO',
            code: 'AUTHENTICATION_REQUIRED',
            message: `Zoho account ${account.email} has no valid access or refresh token. Please re-authenticate.`,
            retryable: false,
        });
    }
    async resolveToken(account) {
        const auth = await this.authenticate(account);
        return auth.accessToken;
    }
    async resolveAccountId(accessToken, account) {
        if (account?.providerUserId && account.providerUserId !== '0') {
            return account.providerUserId;
        }
        // Discover from Zoho accounts endpoint
        const accounts = await (0, mail_fetcher_1.getZohoAccounts)(accessToken);
        if (accounts.length > 0 && accounts[0].accountId) {
            return accounts[0].accountId;
        }
        throw new errors_1.MailProviderError({
            provider: 'ZOHO',
            code: 'ACCOUNT_NOT_FOUND',
            message: 'Could not discover a valid Zoho accountId for this mailbox.',
            retryable: false,
        });
    }
    async listMessages(options, account) {
        const token = await this.resolveToken(account);
        const accountId = await this.resolveAccountId(token, account);
        const baseUrl = account?.providerMetadata?.apiUrl || undefined;
        return (0, mail_fetcher_1.fetchZohoMessages)(token, {
            ...options,
            mailboxId: accountId,
        }, baseUrl);
    }
    async getMessage(messageId, account) {
        const token = await this.resolveToken(account);
        const accountId = await this.resolveAccountId(token, account);
        const folderId = account?.providerMetadata?.folderId || '0';
        const baseUrl = account?.providerMetadata?.apiUrl || undefined;
        // Fetch message details and content
        const url = `/accounts/${accountId}/folders/${folderId}/messages/${messageId}/details`;
        const detailsRes = await (0, zoho_client_1.zohoGet)(url, token, baseUrl);
        const raw = detailsRes.data || { messageId };
        const content = await (0, mail_fetcher_1.fetchZohoContent)(token, accountId, folderId, messageId, baseUrl);
        return (0, mail_fetcher_1.normalizeZohoMessage)({
            messageId,
            folderId: raw.folderId || folderId,
            subject: raw.subject,
            from: raw.from || raw.fromAddress || raw.sender,
            receivedTime: raw.receivedTime || new Date().toISOString(),
            hasAttachment: raw.hasAttachment ?? raw.hasAttachments,
            summary: raw.summary,
        }, accountId, content);
    }
    async listAttachments(messageId, account) {
        const token = await this.resolveToken(account);
        const accountId = await this.resolveAccountId(token, account);
        const folderId = account?.providerMetadata?.folderId || '0';
        const baseUrl = account?.providerMetadata?.apiUrl || undefined;
        return (0, attachments_1.fetchZohoAttachmentList)(token, accountId, folderId, messageId, baseUrl);
    }
    async downloadAttachment(messageId, attachmentId, account) {
        const token = await this.resolveToken(account);
        const accountId = await this.resolveAccountId(token, account);
        const folderId = account?.providerMetadata?.folderId || '0';
        const baseUrl = account?.providerMetadata?.apiUrl || undefined;
        return (0, attachments_1.downloadZohoAttachment)(token, accountId, folderId, messageId, attachmentId, baseUrl);
    }
}
exports.ZohoMailProvider = ZohoMailProvider;
exports.zohoMailProvider = new ZohoMailProvider();
