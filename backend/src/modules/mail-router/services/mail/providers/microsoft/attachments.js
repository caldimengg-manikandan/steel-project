"use strict";
// src/lib/mail/providers/microsoft/attachments.ts
// -----------------------------------------------------------------------------
// Microsoft Graph Attachment Operations
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchAttachmentList = fetchAttachmentList;
exports.downloadAttachmentContent = downloadAttachmentContent;
const graph_client_1 = require("./graph-client");
/**
 * List attachment metadata for a Microsoft Graph message.
 */
async function fetchAttachmentList(accessToken, mailboxId, messageId) {
    const basePath = mailboxId === 'me' ? '/me' : `/users/${encodeURIComponent(mailboxId)}`;
    let data;
    try {
        data = await (0, graph_client_1.graphGet)(`${basePath}/messages/${encodeURIComponent(messageId)}/attachments?$select=id,name,contentType,size,isInline`, accessToken);
    } catch {
        data = await (0, graph_client_1.graphGet)(`${basePath}/messages/${encodeURIComponent(messageId)}/attachments`, accessToken);
    }
    return (data.value ?? []).map((att) => ({
        id: att.id,
        providerAttachmentId: att.id,
        filename: att.name,
        contentType: att.contentType || 'application/octet-stream',
        sizeBytes: att.size ?? null,
        isInline: Boolean(att.isInline),
        contentId: att.contentId ? String(att.contentId).replace(/^<|>$/g, '').trim() : null,
    }));
}
/**
 * Download raw binary content of an attachment from Microsoft Graph.
 */
async function downloadAttachmentContent(accessToken, mailboxId, messageId, attachmentId) {
    const basePath = mailboxId === 'me' ? '/me' : `/users/${encodeURIComponent(mailboxId)}`;
    const endpoint = `${basePath}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;
    // First try JSON endpoint (most attachments have contentBytes as base64)
    const data = await (0, graph_client_1.graphGet)(endpoint, accessToken);
    if (data.contentBytes) {
        return {
            content: Buffer.from(data.contentBytes, 'base64'),
            contentType: data.contentType || 'application/octet-stream',
            filename: data.name,
        };
    }
    // Fallback: stream attachment $value
    const response = await (0, graph_client_1.graphGetRaw)(`${endpoint}/$value`, accessToken);
    const arrayBuffer = await response.arrayBuffer();
    return {
        content: Buffer.from(arrayBuffer),
        contentType: response.headers.get('Content-Type') || data.contentType || 'application/octet-stream',
        filename: data.name,
    };
}
