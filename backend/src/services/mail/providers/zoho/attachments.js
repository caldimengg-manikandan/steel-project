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
    const url = `/accounts/${accountId}/folders/${fId}/messages/${messageId}/attachmentinfo`;
    try {
        const res = await (0, zoho_client_1.zohoGet)(url, accessToken, baseUrl);
        const rawData = res.data;
        let items = [];
        if (Array.isArray(rawData)) {
            items = rawData;
        }
        else if (rawData &&
            typeof rawData === 'object' &&
            'attachments' in rawData &&
            Array.isArray(rawData.attachments)) {
            items = rawData.attachments;
        }
        return items.map((att) => ({
            id: String(att.attachmentId),
            providerAttachmentId: String(att.attachmentId),
            filename: att.attachmentName || att.fileName || 'attachment',
            contentType: att.contentType || 'application/octet-stream',
            sizeBytes: att.attachmentSize ?? null,
        }));
    }
    catch (err) {
        console.warn(`[mail:zoho:attachments] Failed to fetch attachment info for msg ${messageId}:`, err);
        return [];
    }
}
/**
 * Download attachment binary content from Zoho Mail.
 * Endpoint: GET /api/accounts/{accountId}/folders/{folderId}/messages/{messageId}/attachments/{attachmentId}
 */
async function downloadZohoAttachment(accessToken, accountId, folderId, messageId, attachmentId, baseUrl) {
    const fId = folderId || '0';
    const url = `/accounts/${accountId}/folders/${fId}/messages/${messageId}/attachments/${attachmentId}`;
    const response = await (0, zoho_client_1.zohoGetRaw)(url, accessToken, { Accept: 'application/octet-stream' }, baseUrl);
    const arrayBuffer = await response.arrayBuffer();
    const content = Buffer.from(arrayBuffer);
    const contentType = response.headers.get('Content-Type') || 'application/octet-stream';
    // Attempt to parse filename from Content-Disposition header
    const disposition = response.headers.get('Content-Disposition') || '';
    let filename = 'downloaded_attachment';
    const match = /filename\*?=['"]?(?:UTF-\d['"]*)?([^;\r\n"']*)['"]?/i.exec(disposition);
    if (match && match[1]) {
        filename = decodeURIComponent(match[1]);
    }
    return {
        content,
        contentType,
        filename,
    };
}
