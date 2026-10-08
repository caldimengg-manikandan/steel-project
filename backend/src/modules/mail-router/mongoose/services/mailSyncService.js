// backend-cjs/mongoose/services/mailSyncService.js
// -----------------------------------------------------------------------------
// Orchestrates multi-provider mail synchronization (Microsoft + Zoho)
// using native Mongoose repositories and MongoDB.
// -----------------------------------------------------------------------------

const { localRangeToUtcWindow, getTodayUtcWindow } = require('../../services/mail/timezone');
const { getMailProvider } = require('../../services/mail/provider-factory');
const { updateAccountSyncStatus } = require('./accountService');
const { upsertEmail, updateEmailBodyHtml } = require('../repositories/emailRepo');
const { upsertAttachment } = require('../repositories/attachmentRepo');
const { resolveInlineImages } = require('./inlineImageService');
const Attachment = require('../models/Attachment');
const Email = require('../models/Email');
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
 * In-flight map to deduplicate concurrent sync operations for the same mailbox account.
 * Guarantees that auto-sync and user manual clicks never collide or double-sync.
 */
const activeSyncPromisesByAccount = new Map();

/**
 * Trigger mail synchronisation for an account/provider across a UTC window.
 */
async function runMailSync(options) {
  const { userId, startDate, endDate, account, folder } = options;
  const providerType = account?.provider || options.provider || 'MICROSOFT';
  const accountId = account?._id || account?.id;
  const cleanFolder = folder ? String(folder).toLowerCase() : 'inbox';
  if (cleanFolder === 'history') {
    console.log('[mail-router:sync] Skipping remote sync for local history folder.');
    return { id: 'history_local', status: 'COMPLETED', message: 'History folder is indexed locally from forwarded emails.' };
  }
  if (cleanFolder === 'outbox' && providerType === 'MICROSOFT') {
    console.log('[mail-router:sync] Skipping outbox sync for Microsoft (not present in modern Outlook).');
    return { id: 'outbox_ms_skipped', status: 'COMPLETED', message: 'Modern Microsoft Outlook does not have an outbox folder.' };
  }
  const lockKey = accountId ? `${accountId}_${cleanFolder}` : `${userId}_${providerType}_${cleanFolder}`;

  if (activeSyncPromisesByAccount.has(lockKey)) {
    console.log(`[mail-router:sync] Sync operation already in-flight for account ${lockKey}. Joining existing job.`);
    return activeSyncPromisesByAccount.get(lockKey);
  }

  const syncPromise = (async () => {
    return executeMailSync(options);
  })();

  activeSyncPromisesByAccount.set(lockKey, syncPromise);
  try {
    return await syncPromise;
  } finally {
    activeSyncPromisesByAccount.delete(lockKey);
  }
}

async function executeMailSync(options) {
  const { userId, startDate, endDate, account, folder } = options;
  const providerType = account?.provider || options.provider || 'MICROSOFT';
  const cleanFolder = folder ? String(folder).toLowerCase() : 'inbox';
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

  // If this is a custom folder, resolve its remoteFolderId from MailFolder mapping if not already provided
  let resolvedRemoteFolderId = options.remoteFolderId;
  if (!resolvedRemoteFolderId && cleanFolder && !['inbox', 'sent', 'spam', 'drafts', 'draft', 'outbox', 'history'].includes(cleanFolder)) {
    try {
      const MailFolder = require('../models/MailFolder');
      const customFolderDoc = await MailFolder.findOne({
        userId,
        provider: providerType,
        folderId: cleanFolder,
      }).lean();
      if (customFolderDoc) {
        resolvedRemoteFolderId = customFolderDoc.remoteFolderId;
      }
    } catch (mfErr) {
      console.warn('[mail-router:sync] Failed to lookup custom folder mapping:', mfErr.message);
    }
  }

  try {
    while (true) {
      const pageResult = await mailProvider.listMessages(
        {
          mailboxId: syncAccount.providerUserId,
          startDate: cleanFolder === 'spam' ? undefined : window.start,
          endDate: cleanFolder === 'spam' ? undefined : window.end,
          cursor: isFirstPage ? undefined : cursor || undefined,
          folder: cleanFolder,
          remoteFolderId: resolvedRemoteFolderId,
        },
        syncAccount
      );

      isFirstPage = false;
      pagesFetched += 1;

      // Persist messages on this page
      for (const message of pageResult.messages) {
        const savedEmail = await upsertEmail(
          message,
          jobId,
          syncAccount._id || syncAccount.id,
          syncAccount.userId,
          cleanFolder,
          resolvedRemoteFolderId
        );
        messagesSynced += 1;

        const hasInline = /cid:[^\s"'>]+/i.test(message.bodyHtml || '') || /ImageDisplay/i.test(message.bodyHtml || '');
        if (message.hasAttachments || hasInline) {
          const emailDbId = savedEmail._id || savedEmail.id;
          await syncAttachmentsForMessage(mailProvider, syncAccount, message, emailDbId);

          if (hasInline) {
            try {
              const mongoose = require('mongoose');
              const emailIds = [emailDbId];
              if (typeof emailDbId === 'string' && mongoose.Types.ObjectId.isValid(emailDbId)) {
                emailIds.push(new mongoose.Types.ObjectId(emailDbId));
              } else if (emailDbId && emailDbId.toString) {
                emailIds.push(emailDbId.toString());
              }
              const fullAtts = await Attachment.find({ emailId: { $in: emailIds } }).lean();
              const currentEmail = await Email.findById(emailDbId).select('bodyHtml').lean();
              const sourceHtml = currentEmail?.bodyHtml || savedEmail.bodyHtml;
              const { html: resolvedHtml } = resolveInlineImages(sourceHtml, fullAtts);
              if (resolvedHtml && resolvedHtml !== sourceHtml) {
                await updateEmailBodyHtml(emailDbId, resolvedHtml);
              }
            } catch (inlineErr) {
              console.warn('[mail-router:sync] Failed to resolve inline images:', inlineErr.message);
            }
          }
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

/**
 * Determine whether an attachment is an inline/CID image that must be downloaded
 * during email sync to ensure email HTML previews render correctly.
 */
function isInlineCidImage(att, bodyHtml) {
  const html = (bodyHtml || '').toLowerCase();
  const cleanCid = att.contentId ? String(att.contentId).replace(/^<|>$/g, '').trim().toLowerCase() : null;
  const filename = (att.filename || '').toLowerCase();
  const isImg = (att.contentType && att.contentType.toLowerCase().startsWith('image/')) ||
                /\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i.test(filename);

  // 0. Zoho ImageDisplay reference in HTML body
  if (html.includes('imagedisplay')) {
    if (cleanCid && (html.includes(cleanCid) || html.includes(encodeURIComponent(cleanCid)))) {
      return true;
    }
    if (filename && (html.includes(filename) || html.includes(encodeURIComponent(filename)))) {
      return true;
    }
    if (att.isInline && isImg) {
      return true;
    }
  }

  // 1. Explicit CID reference in HTML body
  if (cleanCid && (html.includes(`cid:${cleanCid}`) || html.includes(`cid:&quot;${cleanCid}&quot;`))) {
    return true;
  }

  // 2. Reference by filename in CID
  if (filename && html.includes(`cid:${filename}`)) {
    return true;
  }

  // 3. Email body contains CID references and attachment is marked inline
  if (html.includes('cid:') && att.isInline && isImg) {
    return true;
  }

  // 4. Marked inline and is an image
  if (att.isInline && isImg) {
    return true;
  }

  // 5. Has a contentId and is an image (common in Outlook/Zoho signatures)
  if (cleanCid && isImg) {
    return true;
  }

  return false;
}

/**
 * Optimized attachment sync for a message:
 * 1. Fetch & save attachment metadata (filename, MIME type, size, providerAttachmentId, CID).
 * 2. Download ONLY inline/CID images required for email preview rendering.
 * 3. Never download normal attachments during sync (deferred to on-demand preview/download).
 * 4. Never download an attachment if it is already cached in MongoDB.
 */
async function syncAttachmentsForMessage(provider, account, message, emailId) {
  try {
    const attachmentList = await provider.listAttachments(message.providerMessageId, account);
    if (!attachmentList || !Array.isArray(attachmentList) || attachmentList.length === 0) {
      return;
    }

    let hasNewInlineContent = false;

    for (const att of attachmentList) {
      const providerAttachmentId = att.providerAttachmentId || att.id;
      if (!providerAttachmentId) continue;

      // Check whether attachment is already cached in MongoDB
      const existing = await Attachment.findOne({
        emailId,
        providerAttachmentId,
      }).select('_id content').lean();

      const isAlreadyCached = Boolean(existing && existing.content && existing.content.length > 0);

      // Check if this is an inline/CID image needed for email preview
      const isInline = isInlineCidImage(att, message.bodyHtml);

      let contentToSave = undefined;

      // Download ONLY if it is an inline/CID image and not already cached
      if (isInline && !isAlreadyCached) {
        try {
          const download = await provider.downloadAttachment(message.providerMessageId, providerAttachmentId, account, att.contentId);
          if (download && download.content) {
            contentToSave = download.content;
            hasNewInlineContent = true;
          }
        } catch (downloadErr) {
          console.warn(
            `[mail-router:sync] Could not download inline image ${providerAttachmentId} on message ${message.providerMessageId}:`,
            downloadErr.message
          );
        }
      }

      // Save attachment metadata. Normal attachments are saved with no content (deferred).
      // If already cached, upsertAttachment preserves existing content in MongoDB.
      await upsertAttachment({
        emailId,
        providerAttachmentId,
        filename: att.filename || 'attachment',
        contentType: att.contentType || 'application/octet-stream',
        sizeBytes: att.sizeBytes ?? null,
        isInline: Boolean(att.isInline || isInline),
        contentId: att.contentId ? String(att.contentId).replace(/^<|>$/g, '').trim() : null,
        ...(contentToSave ? { content: contentToSave } : {}),
      });
    }

    // If message HTML contains inline references and we have inline content, resolve and persist updated bodyHtml
    if (message.bodyHtml && (message.bodyHtml.includes('cid:') || message.bodyHtml.includes('ImageDisplay'))) {
      try {
        const { resolveInlineImages } = require('./inlineImageService');
        const Email = require('../models/Email');
        const fullAtts = await Attachment.find({ emailId, content: { $exists: true, $ne: null } }).lean();
        if (fullAtts.length > 0) {
          const { html: resolvedHtml } = resolveInlineImages(message.bodyHtml, fullAtts);
          if (resolvedHtml && resolvedHtml !== message.bodyHtml) {
            await Email.updateOne({ _id: emailId }, { bodyHtml: resolvedHtml });
          }
        }
      } catch (inlineErr) {
        console.warn(`[mail-router:sync] Inline image resolution failed for ${emailId}:`, inlineErr.message);
      }
    }
  } catch (err) {
    console.warn(`[mail-router:sync] Attachment list sync failed for message ${message.providerMessageId}:`, err);
  }
}

module.exports = {
  runMailSync,
};
