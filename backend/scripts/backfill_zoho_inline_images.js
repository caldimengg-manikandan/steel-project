require('dotenv').config();
const mongoose = require('mongoose');

async function backfillZohoInlineImages() {
  await mongoose.connect(process.env.MONGO_URI);
  const Email = require('../src/modules/mail-router/mongoose/models/Email');
  const MailAccount = require('../src/modules/mail-router/mongoose/models/MailAccount');
  const Attachment = require('../src/modules/mail-router/mongoose/models/Attachment');
  const { upsertAttachment } = require('../src/modules/mail-router/mongoose/repositories/attachmentRepo');
  const { resolveInlineImages } = require('../src/modules/mail-router/mongoose/services/inlineImageService');
  const { getMailProvider } = require('../src/modules/mail-router/services/mail/provider-factory');

  const emails = await Email.find({
    provider: 'ZOHO',
    bodyHtml: /ImageDisplay/i
  });

  console.log(`Found ${emails.length} Zoho emails with ImageDisplay in bodyHtml.`);

  const accountCache = new Map();
  const provider = getMailProvider('ZOHO');
  let successCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    const emailId = email._id.toString();
    console.log(`\n[${i + 1}/${emails.length}] Processing: "${email.subject}" (${email.providerMessageId})`);

    let account = accountCache.get(String(email.accountId));
    if (!account && email.accountId) {
      account = await MailAccount.findById(email.accountId);
      if (account) accountCache.set(String(email.accountId), account);
    }

    if (!account) {
      console.warn(`  Account not found for email ${emailId}, skipping.`);
      skippedCount++;
      continue;
    }

    try {
      // 1. Check existing attachments with content
      let fullAttachments = await Attachment.find({ emailId, content: { $exists: true, $ne: null } }).lean();

      // 2. If no content cached, fetch list from Zoho
      if (fullAttachments.length === 0) {
        const attList = await provider.listAttachments(email.providerMessageId, account);
        if (attList && attList.length > 0) {
          for (const att of attList) {
            const providerAttachmentId = att.providerAttachmentId || att.id;
            if (!providerAttachmentId) continue;

            const isImg = (att.contentType && att.contentType.startsWith('image/')) ||
              /\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i.test(att.filename || '');

            let downloadedContent = null;
            if (isImg) {
              try {
                const dl = await provider.downloadAttachment(email.providerMessageId, providerAttachmentId, account, att.contentId);
                if (dl && dl.content) {
                  downloadedContent = dl.content;
                }
              } catch (dlErr) {
                console.warn(`  Download failed for ${att.filename}:`, dlErr.message);
              }
            }

            const savedAtt = await upsertAttachment({
              emailId,
              providerAttachmentId,
              filename: att.filename || 'attachment',
              contentType: att.contentType || 'application/octet-stream',
              sizeBytes: att.sizeBytes ?? null,
              isInline: Boolean(att.isInline),
              contentId: att.contentId ? String(att.contentId).replace(/^<|>$/g, '').trim() : null,
              ...(downloadedContent ? { content: downloadedContent } : {}),
            });

            if (downloadedContent) {
              fullAttachments.push({
                ...(savedAtt.toObject ? savedAtt.toObject() : savedAtt),
                content: downloadedContent,
              });
            }
          }
        }
      }

      // 3. Resolve inline images in bodyHtml
      if (fullAttachments.length > 0) {
        const { html: resolvedHtml, inlineAttachmentIds } = resolveInlineImages(email.bodyHtml, fullAttachments);
        if (resolvedHtml && resolvedHtml !== email.bodyHtml) {
          await Email.updateOne({ _id: email._id }, { bodyHtml: resolvedHtml });
          console.log(`  Successfully resolved and replaced ${inlineAttachmentIds.length} inline images.`);
          successCount++;
        } else {
          console.log(`  No ImageDisplay replacements needed or matched.`);
          skippedCount++;
        }
      } else {
        console.log(`  No attachments downloaded or available for msg ${email.providerMessageId}.`);
        skippedCount++;
      }
    } catch (err) {
      console.error(`  Error processing email ${emailId}:`, err.message);
      errorCount++;
    }
  }

  console.log('\n--- BACKFILL COMPLETE ---');
  console.log(`Total: ${emails.length}, Success: ${successCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`);

  const remaining = await Email.countDocuments({
    provider: 'ZOHO',
    bodyHtml: /ImageDisplay/i
  });
  console.log(`Remaining Zoho emails with unresolved ImageDisplay: ${remaining}`);

  await mongoose.disconnect();
}

backfillZohoInlineImages().catch(console.error);
