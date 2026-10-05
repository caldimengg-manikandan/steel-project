"use strict";
// src/lib/mail/providers/zoho/attachments.ts
// -----------------------------------------------------------------------------
// Zoho Mail Attachment Operations.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchZohoAttachmentList = fetchZohoAttachmentList;
exports.downloadZohoAttachment = downloadZohoAttachment;
const zoho_client_1 = require("./zoho-client");
/**
 * List attachments for a Zoho Mail message.
 * Endpoint: GET /api/accounts/{accountId}/folders/{folderId}/messages/{messageId}/attachmentinfo
 * If folderId is not known, '0' or Inbox folder is used.
 */
async function fetchZohoAttachmentList(accessToken, accountId, folderId, messageId, baseUrl) {
    const fId = folderId || '0';
    const url = `/accounts/${accountId}/folders/${fId}/messages/${messageId}/attachmentinfo?includeInline=true`;
    try {
        const res = await (0, zoho_client_1.zohoGet)(url, accessToken, baseUrl);
        const rawData = res.data;
        let items = [];
        if (Array.isArray(rawData)) {
            items = rawData;
        }
        else if (rawData && typeof rawData === 'object') {
            if (Array.isArray(rawData.attachments)) {
                for (const att of rawData.attachments) {
                    items.push({ ...att, isInline: false });
                }
            }
            if (Array.isArray(rawData.inline)) {
                for (const att of rawData.inline) {
                    items.push({ ...att, isInline: true });
                }
            }
        }
        return items.map((att) => {
            const filename = att.attachmentName || att.fileName || 'attachment';
            let contentType = att.contentType;
            if (!contentType || contentType === 'application/octet-stream') {
                const ext = filename.split('.').pop()?.toLowerCase();
                if (ext === 'jpg' || ext === 'jpeg') contentType = 'image/jpeg';
                else if (ext === 'png') contentType = 'image/png';
                else if (ext === 'gif') contentType = 'image/gif';
                else if (ext === 'webp') contentType = 'image/webp';
                else if (ext === 'svg') contentType = 'image/svg+xml';
                else contentType = 'application/octet-stream';
            }
            return {
                id: String(att.attachmentId),
                providerAttachmentId: String(att.attachmentId),
                filename,
                contentType,
                sizeBytes: att.attachmentSize ?? null,
                isInline: Boolean(att.isInline || att.inline),
                contentId: att.contentId || att.cid ? String(att.contentId || att.cid).replace(/^<|>$/g, '').trim() : null,
            };
        });
    }
    catch (err) {
        console.warn(`[mail:zoho:attachments] Failed to fetch attachment info for msg ${messageId}:`, err);
        return [];
    }
}
/**
 * Download attachment binary content from Zoho Mail.
 * Endpoint: GET /api/accounts/{accountId}/folders/{folderId}/messages/{messageId}/attachments/{attachmentId}
 * Fallback Endpoint for inline: GET /api/accounts/{accountId}/folders/{folderId}/messages/{messageId}/inline?contentId={cid}
 */
async function downloadZohoAttachment(accessToken, accountId, folderId, messageId, attachmentId, baseUrl, contentId) {
    const fId = folderId || '0';
    const url = `/accounts/${accountId}/folders/${fId}/messages/${messageId}/attachments/${attachmentId}`;
    let response;
    try {
        response = await (0, zoho_client_1.zohoGetRaw)(url, accessToken, { Accept: 'application/octet-stream' }, baseUrl);
    } catch (primaryErr) {
        if (contentId) {
            const inlineUrl = `/accounts/${accountId}/folders/${fId}/messages/${messageId}/inline?contentId=${encodeURIComponent(contentId)}`;
            response = await (0, zoho_client_1.zohoGetRaw)(inlineUrl, accessToken, { Accept: 'application/octet-stream' }, baseUrl);
        } else {
            throw primaryErr;
        }
    }
    const arrayBuffer = await response.arrayBuffer();
    const content = Buffer.from(arrayBuffer);
    let contentType = response.headers.get('Content-Type') || 'application/octet-stream';
    if (contentType.includes(';')) {
        contentType = contentType.split(';')[0].trim();
    }
    // Attempt to parse filename from Content-Disposition header
    const disposition = response.headers.get('Content-Disposition') || '';
    let filename = 'downloaded_attachment';
    const match = /filename\*?=['"]?(?:UTF-\d['"]*)?([^;\r\n"']*)['"]?/i.exec(disposition);
    if (match && match[1]) {
        filename = decodeURIComponent(match[1]);
    }
    // Detect image type from magic bytes if octet-stream
    if (contentType === 'application/octet-stream' && content.length >= 4) {
        if (content[0] === 0xFF && content[1] === 0xD8 && content[2] === 0xFF) {
            contentType = 'image/jpeg';
        } else if (content[0] === 0x89 && content[1] === 0x50 && content[2] === 0x4E && content[3] === 0x47) {
            contentType = 'image/png';
        } else if (content[0] === 0x47 && content[1] === 0x49 && content[2] === 0x46) {
            contentType = 'image/gif';
        } else if (content[0] === 0x52 && content[1] === 0x49 && content[2] === 0x46 && content[3] === 0x46) {
            contentType = 'image/webp';
        }
    }
    return {
        content,
        contentType,
        filename,
    };
}
