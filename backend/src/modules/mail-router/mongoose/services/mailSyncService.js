// backend-cjs/mongoose/services/mailSyncService.js
// -----------------------------------------------------------------------------
// Orchestrates multi-provider mail synchronization (Microsoft + Zoho)
// using native Mongoose repositories and MongoDB.
// -----------------------------------------------------------------------------

const { localRangeToUtcWindow, getTodayUtcWindow } = require('../../services/mail/timezone');
const { getMailProvider } = require('../../services/mail/provider-factory');
const { updateAccountSyncStatus } = require('./accountService');
const { upsertEmail } = require('../repositories/emailRepo');
const { upsertAttachment } = require('../repositories/attachmentRepo');
const {
  createSyncJob,
  markJobRunning,
  updateJobProgress,
  markJobCompleted,
  markJobFailed,
  markJobPartial,
  getSyncJob,
} = require('../repositories/syncJobRepo');

/**
 * Trigger mail synchronisation for an account/provider across a UTC window.
 */
async function runMailSync(options) {
  const { userId, startDate, endDate, account } = options;
  const providerType = account?.provider || options.provider || 'MICROSOFT';
  const mailProvider = getMailProvider(providerType);

  // Resolve the UTC window
  const window = startDate && endDate
    ? localRangeToUtcWindow(startDate, endDate)
    : getTodayUtcWindow();

  // Create the job record in MongoDB
  const job = await createSyncJob(userId, window.start, window.end);
  await markJobRunning(job.id || job._id);

  let pagesFetched = 0;
  let messagesSynced = 0;
  let cursor = null;
  let isFirstPage = true;

  if (!account) {
    throw new Error('[mail-router:sync] A MailAccount record is required. Connect a mailbox via OAuth first.');
  }

  const syncAccount = account;
  const startTime = Date.now();
  const jobId = String(job.id || job._id);

  try {
    while (true) {
      const pageResult = await mailProvider.listMessages(
        {
          mailboxId: syncAccount.providerUserId,
          startDate: window.start,
          endDate: window.end,
          cursor: isFirstPage ? undefined : cursor || undefined,
        },
        syncAccount
      );

      isFirstPage = false;
      pagesFetched += 1;

      // Persist messages on this page
      for (const message of pageResult.messages) {
        const savedEmail = await upsertEmail(message, jobId, syncAccount._id || syncAccount.id);
        messagesSynced += 1;

        if (message.hasAttachments) {
          await syncAttachmentsForMessage(mailProvider, syncAccount, message, savedEmail._id || savedEmail.id);
        }
      }

      cursor = pageResult.nextCursor || null;
      await updateJobProgress(jobId, pagesFetched, messagesSynced, cursor);

      if (!cursor || !pageResult.hasMore) {
        break;
      }
    }

    // Mark completion
    await markJobCompleted(jobId, pagesFetched, messagesSynced);
    const accountId = syncAccount._id || syncAccount.id;
    if (accountId) {
      await updateAccountSyncStatus(accountId, 'COMPLETED');
    }

    const duration = Date.now() - startTime;
    console.log(
      `[mail-router:sync] provider=${providerType} mailbox=${syncAccount.email} ` +
        `status=success messages=${messagesSynced} pages=${pagesFetched} duration=${duration}ms`
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const duration = Date.now() - startTime;

    if (pagesFetched > 0) {
      await markJobPartial(jobId, errorMessage);
    } else {
      await markJobFailed(jobId, errorMessage);
    }

    const accountId = syncAccount._id || syncAccount.id;
    if (accountId) {
      await updateAccountSyncStatus(accountId, 'FAILED');
    }

    console.error(
      `[mail-router:sync] provider=${providerType} mailbox=${syncAccount.email} ` +
        `status=failed duration=${duration}ms error=${errorMessage}`
    );
    throw err;
  }

  return getSyncJob(jobId);
}

async function syncAttachmentsForMessage(provider, account, message, emailId) {
  try {
    const attachmentList = await provider.listAttachments(message.providerMessageId, account);
    for (const att of attachmentList) {
      let content = null;
      try {
        const download = await provider.downloadAttachment(message.providerMessageId, att.providerAttachmentId, account);
        content = download.content;
      } catch (err) {
        console.warn(
          `[mail-router:sync] Could not download content for attachment ` +
            `${att.providerAttachmentId} on message ${message.providerMessageId}:`,
          err
        );
      }

      await upsertAttachment({
        emailId,
        providerAttachmentId: att.providerAttachmentId,
        filename: att.filename,
        contentType: att.contentType,
        sizeBytes: att.sizeBytes,
        content,
      });
    }
  } catch (err) {
    console.warn(`[mail-router:sync] Attachment list sync failed for message ${message.providerMessageId}:`, err);
  }
}

module.exports = {
  runMailSync,
};
