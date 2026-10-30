// backend-cjs/mongoose/services/inlineImageService.js
// -----------------------------------------------------------------------------
// Resolves inline `cid:` and Zoho `ImageDisplay` image references in email HTML bodies
// by converting them into lightweight server endpoint URLs (/steel/api/mail/attachments/:id).
// Keeps email document size in MongoDB minimal (a few KB instead of megabytes).
// -----------------------------------------------------------------------------

function cleanCidString(str) {
  if (!str) return '';
  return String(str).replace(/^<|>$/g, '').trim();
}

/**
 * Resolves inline `cid:` and Zoho `ImageDisplay` image references in an email's bodyHtml
 * by converting matching image attachments into endpoint URLs.
 *
 * @param {string} bodyHtml - Raw email HTML body
 * @param {Array} attachments - Attachment documents from DB (metadata only, no content buffer required)
 * @returns {{ html: string, inlineAttachmentIds: string[] }}
 */
function resolveInlineImages(bodyHtml, attachments) {
  if (!bodyHtml || typeof bodyHtml !== 'string') {
    return { html: bodyHtml || '', inlineAttachmentIds: [] };
  }
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
    return { html: bodyHtml, inlineAttachmentIds: [] };
  }

  let updatedHtml = bodyHtml;
  const matchedAttIds = new Set();

  // ---------------------------------------------------------------------------
  // 1. Process Outlook/Standard `cid:` references
  // ---------------------------------------------------------------------------
  const cidsFound = [];
  const cidRegex = /src=["']cid:([^"']+)["']/gi;
  let match;
  while ((match = cidRegex.exec(bodyHtml)) !== null) {
    cidsFound.push(match[1]);
  }

  for (const cid of cidsFound) {
    const cleanCid = cleanCidString(cid);
    const att = attachments.find(a => {
      const aCid = cleanCidString(a.contentId);
      if (aCid && aCid.toLowerCase() === cleanCid.toLowerCase()) return true;
      if (a.filename && cleanCid.toLowerCase().includes(a.filename.toLowerCase())) return true;
      return false;
    });

    if (att) {
      const attId = String(att._id || att.id);
      const viewUrl = `/steel/api/mail/attachments/${attId}`;
      const escapedCid = cleanCid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      updatedHtml = updatedHtml.replace(new RegExp(`src=["']cid:${escapedCid}["']`, 'gi'), `src="${viewUrl}"`);
      matchedAttIds.add(attId);
    }
  }

  // Pass 1b: Match remaining CIDs by order with remaining image attachments
  const remainingCids = [];
  const remainingCidRegex = /src=["']cid:([^"']+)["']/gi;
  while ((match = remainingCidRegex.exec(updatedHtml)) !== null) {
    remainingCids.push(match[1]);
  }

  if (remainingCids.length > 0) {
    const availableImageAtts = attachments.filter(a => {
      if (matchedAttIds.has(String(a._id || a.id))) return false;
      const isImg = (a.contentType && a.contentType.startsWith('image/')) ||
                    /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(a.filename || '');
      return isImg;
    });

    for (let i = 0; i < remainingCids.length && i < availableImageAtts.length; i++) {
      const cid = remainingCids[i];
      const att = availableImageAtts[i];
      const attId = String(att._id || att.id);
      const viewUrl = `/steel/api/mail/attachments/${attId}`;
      const escapedCid = cleanCidString(cid).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      updatedHtml = updatedHtml.replace(new RegExp(`src=["']cid:${escapedCid}["']`, 'gi'), `src="${viewUrl}"`);
      matchedAttIds.add(attId);
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Process Zoho `ImageDisplay` references
  // E.g.: src="/mail/ImageDisplay?na=...&amp;nmsgId=...&amp;f=1.jpg&amp;mode=inline&amp;cid=..."
  // ---------------------------------------------------------------------------
  const zohoRegex = /src=(["'])([^"']*ImageDisplay[^"']*)\1/gi;
  const zohoMatches = [];
  while ((match = zohoRegex.exec(updatedHtml)) !== null) {
    zohoMatches.push({
      fullTag: match[0],
      quote: match[1],
      rawUrl: match[2],
    });
  }

  for (const { rawUrl } of zohoMatches) {
    const cidMatch = /(?:[?&]|&amp;)cid=([^&"'\s>]+)/i.exec(rawUrl);
    const fMatch = /(?:[?&]|&amp;)f=([^&"'\s>]+)/i.exec(rawUrl);
    const cid = cidMatch ? decodeURIComponent(cidMatch[1]).trim() : null;
    const filename = fMatch ? decodeURIComponent(fMatch[1]).trim() : null;

    let att = null;

    if (cid) {
      const cleanCid = cleanCidString(cid);
      att = attachments.find(a => {
        const aCid = cleanCidString(a.contentId);
        return aCid && aCid.toLowerCase() === cleanCid.toLowerCase();
      });
    }

    if (!att && filename) {
      att = attachments.find(a => {
        return a.filename && a.filename.toLowerCase() === filename.toLowerCase();
      });
    }

    if (!att && cid) {
      att = attachments.find(a => {
        return a.filename && cid.toLowerCase().includes(a.filename.toLowerCase());
      });
    }

    if (!att) {
      att = attachments.find(a => !matchedAttIds.has(String(a._id || a.id)));
    }

    if (att) {
      const attId = String(att._id || att.id);
      const viewUrl = `/steel/api/mail/attachments/${attId}`;
      updatedHtml = updatedHtml.split(rawUrl).join(viewUrl);
      matchedAttIds.add(attId);
    }
  }

  return { html: updatedHtml, inlineAttachmentIds: Array.from(matchedAttIds) };
}

module.exports = {
  resolveInlineImages,
};
