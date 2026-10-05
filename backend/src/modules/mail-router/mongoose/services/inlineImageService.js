// backend-cjs/mongoose/services/inlineImageService.js
// -----------------------------------------------------------------------------
// Resolves inline `cid:` image references in email HTML bodies
// by converting matching image attachments into base64 data URIs.
// -----------------------------------------------------------------------------

function getImageMime(att) {
  let mime = att.contentType;
  if (mime && mime.includes(';')) {
    mime = mime.split(';')[0].trim();
  }
  if (mime && mime.startsWith('image/')) {
    return mime;
  }
  const filename = (att.filename || '').toLowerCase();
  if (/\.jpe?g$/i.test(filename)) return 'image/jpeg';
  if (/\.png$/i.test(filename)) return 'image/png';
  if (/\.gif$/i.test(filename)) return 'image/gif';
  if (/\.webp$/i.test(filename)) return 'image/webp';
  if (/\.svg$/i.test(filename)) return 'image/svg+xml';
  if (/\.bmp$/i.test(filename)) return 'image/bmp';
  if (/\.ico$/i.test(filename)) return 'image/x-icon';

  if (att.content && Buffer.isBuffer(att.content) && att.content.length >= 4) {
    if (att.content[0] === 0xFF && att.content[1] === 0xD8 && att.content[2] === 0xFF) return 'image/jpeg';
    if (att.content[0] === 0x89 && att.content[1] === 0x50 && att.content[2] === 0x4E && att.content[3] === 0x47) return 'image/png';
    if (att.content[0] === 0x47 && att.content[1] === 0x49 && att.content[2] === 0x46) return 'image/gif';
    if (att.content[0] === 0x52 && att.content[1] === 0x49 && att.content[2] === 0x46 && att.content[3] === 0x46) return 'image/webp';
  }
  return 'image/png';
}

function cleanCidString(str) {
  if (!str) return '';
  return String(str).replace(/^<|>$/g, '').trim();
}

/**
 * Resolves inline `cid:` and Zoho `ImageDisplay` image references in an email's bodyHtml
 * by converting matching image attachments into base64 data URIs.
 *
 * @param {string} bodyHtml - Raw email HTML body
 * @param {Array} attachmentsWithContent - Attachment documents from DB (including `content` Buffer)
 * @returns {{ html: string, inlineAttachmentIds: string[] }}
 */
function resolveInlineImages(bodyHtml, attachmentsWithContent) {
  if (!bodyHtml || typeof bodyHtml !== 'string') {
    return { html: bodyHtml || '', inlineAttachmentIds: [] };
  }
  if (!attachmentsWithContent || !Array.isArray(attachmentsWithContent) || attachmentsWithContent.length === 0) {
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
    const att = attachmentsWithContent.find(a => {
      const aCid = cleanCidString(a.contentId);
      if (aCid && aCid.toLowerCase() === cleanCid.toLowerCase()) return true;
      if (a.filename && cleanCid.toLowerCase().includes(a.filename.toLowerCase())) return true;
      return false;
    });

    if (att && att.content) {
      const mime = getImageMime(att);
      const dataUri = `data:${mime};base64,${att.content.toString('base64')}`;
      const escapedCid = cleanCid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      updatedHtml = updatedHtml.replace(new RegExp(`src=["']cid:${escapedCid}["']`, 'gi'), `src="${dataUri}"`);
      matchedAttIds.add(String(att._id || att.id));
    }
  }

  // Pass 1b: Match remaining CIDs by order with remaining image attachments
  const remainingCids = [];
  const remainingCidRegex = /src=["']cid:([^"']+)["']/gi;
  while ((match = remainingCidRegex.exec(updatedHtml)) !== null) {
    remainingCids.push(match[1]);
  }

  if (remainingCids.length > 0) {
    const availableImageAtts = attachmentsWithContent.filter(a => {
      if (matchedAttIds.has(String(a._id || a.id))) return false;
      const isImg = (a.contentType && a.contentType.startsWith('image/')) ||
                    /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(a.filename || '');
      return isImg && a.content;
    });

    for (let i = 0; i < remainingCids.length && i < availableImageAtts.length; i++) {
      const cid = remainingCids[i];
      const att = availableImageAtts[i];
      const mime = getImageMime(att);
      const dataUri = `data:${mime};base64,${att.content.toString('base64')}`;
      const escapedCid = cleanCidString(cid).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      updatedHtml = updatedHtml.replace(new RegExp(`src=["']cid:${escapedCid}["']`, 'gi'), `src="${dataUri}"`);
      matchedAttIds.add(String(att._id || att.id));
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
    // Extract query parameters
    const cidMatch = /(?:[?&]|&amp;)cid=([^&"'\s>]+)/i.exec(rawUrl);
    const fMatch = /(?:[?&]|&amp;)f=([^&"'\s>]+)/i.exec(rawUrl);
    const cid = cidMatch ? decodeURIComponent(cidMatch[1]).trim() : null;
    const filename = fMatch ? decodeURIComponent(fMatch[1]).trim() : null;

    let att = null;

    // Try matching by CID first
    if (cid) {
      const cleanCid = cleanCidString(cid);
      att = attachmentsWithContent.find(a => {
        const aCid = cleanCidString(a.contentId);
        return aCid && aCid.toLowerCase() === cleanCid.toLowerCase();
      });
    }

    // Try matching by filename
    if (!att && filename) {
      att = attachmentsWithContent.find(a => {
        return a.filename && a.filename.toLowerCase() === filename.toLowerCase();
      });
    }

    // Try matching by filename inside CID
    if (!att && cid) {
      att = attachmentsWithContent.find(a => {
        return a.filename && cid.toLowerCase().includes(a.filename.toLowerCase());
      });
    }

    // Fallback: match any unused image attachment
    if (!att) {
      att = attachmentsWithContent.find(a => !matchedAttIds.has(String(a._id || a.id)) && a.content);
    }

    if (att && att.content) {
      const mime = getImageMime(att);
      const dataUri = `data:${mime};base64,${att.content.toString('base64')}`;
      updatedHtml = updatedHtml.split(rawUrl).join(dataUri);
      matchedAttIds.add(String(att._id || att.id));
    }
  }

  return { html: updatedHtml, inlineAttachmentIds: Array.from(matchedAttIds) };
}

module.exports = {
  resolveInlineImages,
  getImageMime,
};
