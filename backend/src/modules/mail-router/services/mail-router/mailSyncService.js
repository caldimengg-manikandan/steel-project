"use strict";
// src/features/mail-router/services/mailSyncService.ts
// -----------------------------------------------------------------------------
// Orchestrates multi-provider mail synchronization (Microsoft + Zoho).
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMailSync = runMailSync;
const timezone_1 = require("../mail/timezone");
const provider_factory_1 = require("../mail/provider-factory");
const account_service_1 = require("../mail/account-service");
const emailRepo_1 = require("../../repositories/mail/emailRepo");
const attachmentRepo_1 = require("../../repositories/mail/attachmentRepo");
const syncJobRepo_1 = require("../../repositories/mail/syncJobRepo");
/**
 * Trigger mail synchronisation for an account/provider across a UTC window.
 */
async function runMailSync(options) {
    const { userId, accessToken: _accessToken, startDate, endDate, account } = options;
    const providerType = account?.provider || options.provider || 'MICROSOFT';
    const mailProvider = (0, provider_factory_1.getMailProvider)(providerType);
    // Resolve the UTC window
    const window = startDate && endDate
        ? (0, timezone_1.localRangeToUtcWindow)(startDate, endDate)
        : (0, timezone_1.getTodayUtcWindow)();
    // Create the job record
    const job = await (0, syncJobRepo_1.createSyncJob)(userId, window.start, window.end);
    await (0, syncJobRepo_1.markJobRunning)(job.id);
    let pagesFetched = 0;
    let messagesSynced = 0;
    let cursor = null;
    let isFirstPage = true;
    if (!account) {
        throw new Error('[mail-router:sync] A MailAccount record is required. Connect a mailbox via OAuth first.');
    }
    const syncAccount = account;
    const startTime = Date.now();
    try {
        while (true) {
            const pageResult = await mailProvider.listMessages({
                mailboxId: syncAccount.providerUserId,
                startDate: window.start,
                endDate: window.end,
                cursor: isFirstPage ? undefined : (cursor || undefined),
            }, syncAccount);
            isFirstPage = false;
            pagesFetched += 1;
            // Persist messages on this page
            for (const message of pageResult.messages) {
                const savedEmail = await (0, emailRepo_1.upsertEmail)(message, job.id, account?.id);
                messagesSynced += 1;
                if (message.hasAttachments) {
                    await syncAttachmentsForMessage(mailProvider, syncAccount, message, savedEmail.id);
                }
            }
            cursor = pageResult.nextCursor || null;
            await (0, syncJobRepo_1.updateJobProgress)(job.id, pagesFetched, messagesSynced, cursor);
            if (!cursor || !pageResult.hasMore) {
                break;
            }
        }
        // Mark completion
        await (0, syncJobRepo_1.markJobCompleted)(job.id, pagesFetched, messagesSynced);
        if (account?.id) {
            await (0, account_service_1.updateAccountSyncStatus)(account.id, 'COMPLETED');
        }
        const duration = Date.now() - startTime;
        console.log(`[mail-router:sync] provider=${providerType} mailbox=${syncAccount.email} ` +
            `status=success messages=${messagesSynced} pages=${pagesFetched} duration=${duration}ms`);
    }
    catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        const duration = Date.now() - startTime;
        if (pagesFetched > 0) {
            await (0, syncJobRepo_1.markJobPartial)(job.id, errorMessage);
        }
        else {
            await (0, syncJobRepo_1.markJobFailed)(job.id, errorMessage, err);
        }
        if (account?.id) {
            await (0, account_service_1.updateAccountSyncStatus)(account.id, 'FAILED');
        }
        console.error(`[mail-router:sync] provider=${providerType} mailbox=${syncAccount.email} ` +
            `status=failed duration=${duration}ms error=${errorMessage}`);
        throw err;
    }
    return (await (0, syncJobRepo_1.getSyncJob)(job.id));
}
async function syncAttachmentsForMessage(provider, account, message, emailId) {
    try {
        const attachmentList = await provider.listAttachments(message.providerMessageId, account);
        for (const att of attachmentList) {
            let content = null;
            try {
                const download = await provider.downloadAttachment(message.providerMessageId, att.providerAttachmentId, account);
                content = download.content;
            }
            catch (err) {
                console.warn(`[mail-router:sync] Could not download content for attachment ` +
                    `${att.providerAttachmentId} on message ${message.providerMessageId}:`, err);
            }
            await (0, attachmentRepo_1.upsertAttachment)({
                emailId,
                providerAttachmentId: att.providerAttachmentId,
                filename: att.filename,
                contentType: att.contentType,
                sizeBytes: att.sizeBytes,
                content,
            });
        }
    }
    catch (err) {
        console.warn(`[mail-router:sync] Attachment list sync failed for message ${message.providerMessageId}:`, err);
    }
}
