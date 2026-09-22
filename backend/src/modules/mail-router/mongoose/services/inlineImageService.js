// backend-cjs/mongoose/services/inlineImageService.js
// -----------------------------------------------------------------------------
// Resolves inline `cid:` image references in email HTML bodies
// by converting matching image attachments into base64 data URIs.
// -----------------------------------------------------------------------------

/**
 * Resolves inline `cid:` image references in an email's bodyHtml
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
  const cidsFound = [];
  const cidRegex = /src=["']cid:([^"']+)["']/gi;
  let match;
  while ((match = cidRegex.exec(bodyHtml)) !== null) {
    cidsFound.push(match[1]);
  }

  if (cidsFound.length === 0) {
    return { html: bodyHtml, inlineAttachmentIds: [] };
  }

  // Pass 1: Match by explicit contentId or filename in CID
  for (const cid of cidsFound) {
    const cleanCid = cid.trim();
    const att = attachmentsWithContent.find(a => {
      if (a.contentId && a.contentId === cleanCid) return true;
      if (a.filename && cleanCid.toLowerCase().includes(a.filename.toLowerCase())) return true;
      return false;
    });

    if (att && att.content) {
      const mime = att.contentType || 'image/png';
      const dataUri = `data:${mime};base64,${att.content.toString('base64')}`;
      const escapedCid = cleanCid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      updatedHtml = updatedHtml.replace(new RegExp(`src=["']cid:${escapedCid}["']`, 'gi'), `src="${dataUri}"`);
      matchedAttIds.add(String(att._id || att.id));
    }
  }

  // Pass 2: Match remaining CIDs by order with remaining image attachments
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
      const mime = att.contentType || 'image/png';
      const dataUri = `data:${mime};base64,${att.content.toString('base64')}`;
      const escapedCid = cid.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      updatedHtml = updatedHtml.replace(new RegExp(`src=["']cid:${escapedCid}["']`, 'gi'), `src="${dataUri}"`);
      matchedAttIds.add(String(att._id || att.id));
    }
  }

  return { html: updatedHtml, inlineAttachmentIds: Array.from(matchedAttIds) };
}

module.exports = {
  resolveInlineImages,
};
