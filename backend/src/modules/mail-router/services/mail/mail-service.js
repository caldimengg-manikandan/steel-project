"use strict";
// src/lib/mail/mail-service.ts
// -----------------------------------------------------------------------------
// High-Level Mail Service.
// Dispatches mail operations to the appropriate provider transparently.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.mailService = exports.MailService = void 0;
const provider_factory_1 = require("./provider-factory");
class MailService {
    /**
     * Fetch a page of messages for a given mail account.
     */
    async listMessages(account, options) {
        const provider = (0, provider_factory_1.getMailProvider)(account.provider);
        return provider.listMessages({
            ...options,
            mailboxId: account.providerUserId,
        }, account);
    }
    /**
     * Fetch a single message from the underlying provider.
     */
    async getMessage(account, messageId) {
        const provider = (0, provider_factory_1.getMailProvider)(account.provider);
        return provider.getMessage(messageId, account);
    }
    /**
     * List attachments for a message.
     */
    async listAttachments(account, messageId) {
        const provider = (0, provider_factory_1.getMailProvider)(account.provider);
        return provider.listAttachments(messageId, account);
    }
    /**
     * Download attachment binary content.
     */
    async downloadAttachment(account, messageId, attachmentId) {
        const provider = (0, provider_factory_1.getMailProvider)(account.provider);
        return provider.downloadAttachment(messageId, attachmentId, account);
    }
}
exports.MailService = MailService;
exports.mailService = new MailService();
