"use strict";
// src/lib/mail/providers/microsoft/mail-fetcher.ts
// -----------------------------------------------------------------------------
// Microsoft Graph message paginator & fetcher.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.MESSAGE_SELECT_FIELDS = void 0;
exports.normalizeGraphMessage = normalizeGraphMessage;
exports.fetchMessagesPage = fetchMessagesPage;
exports.fetchSingleMessage = fetchSingleMessage;
const graph_client_1 = require("./graph-client");
const content_extractor_1 = require("../../content-extractor");
exports.MESSAGE_SELECT_FIELDS = [
    'id',
    'subject',
    'from',
    'toRecipients',
    'ccRecipients',
    'receivedDateTime',
    'bodyPreview',
    'body',
    'internetMessageId',
    'hasAttachments',
].join(',');
function normalizeGraphMessage(msg, mailboxId) {
    const rawHtml = msg.body?.contentType === 'html' ? msg.body.content ?? null : null;
    const rawText = msg.body?.contentType === 'text' ? msg.body.content ?? null : null;
    const content = (0, content_extractor_1.extractEmailContent)({
        html: rawHtml,
        text: rawText,
    });
    return {
        id: msg.id,
        provider: 'MICROSOFT',
        providerMessageId: msg.id,
        mailboxId,
        subject: msg.subject ?? null,
        fromName: msg.from?.emailAddress?.name ?? null,
        fromAddress: msg.from?.emailAddress?.address ?? '',
        toAddresses: msg.toRecipients?.map((r) => ({
            name: r.emailAddress?.name ?? null,
            address: r.emailAddress?.address ?? '',
        })),
        ccAddresses: msg.ccRecipients?.map((r) => ({
            name: r.emailAddress?.name ?? null,
            address: r.emailAddress?.address ?? '',
        })),
        receivedAt: msg.receivedDateTime,
        bodyPreview: msg.bodyPreview ?? null,
        bodyHtml: content.bodyHtml,
        bodyText: content.bodyText,
        links: content.links,
        internetMessageId: msg.internetMessageId ?? null,
        hasAttachments: Boolean(msg.hasAttachments),
    };
}
/**
 * Fetch a page of messages for a mailbox using Graph.
 */
async function fetchMessagesPage(accessToken, options) {
    const { mailboxId, startDate, endDate, cursor, limit = 50 } = options;
    const basePath = mailboxId === 'me' ? '/me' : `/users/${encodeURIComponent(mailboxId)}`;
    let url;
    if (cursor) {
        url = cursor;
    }
    else {
        const filters = [];
        if (startDate) {
            filters.push(`receivedDateTime ge ${startDate}`);
        }
        if (endDate) {
            filters.push(`receivedDateTime le ${endDate}`);
        }
        const filterQuery = filters.length > 0 ? `&$filter=${encodeURIComponent(filters.join(' and '))}` : '';
        url = `${basePath}/messages?$top=${limit}&$select=${exports.MESSAGE_SELECT_FIELDS}&$orderby=receivedDateTime+asc${filterQuery}`;
    }
    const response = await (0, graph_client_1.graphGet)(url, accessToken);
    const rawList = response.value ?? [];
    const allMessages = rawList.map((m) => normalizeGraphMessage(m, mailboxId));
    // Client-side window guard
    const startMs = startDate ? new Date(startDate).getTime() : undefined;
    const endMs = endDate ? new Date(endDate).getTime() : undefined;
    const messages = allMessages.filter((m) => {
        const time = new Date(m.receivedAt).getTime();
        if (endMs !== undefined && !isNaN(endMs) && time > endMs)
            return false;
        if (startMs !== undefined && !isNaN(startMs) && time < startMs)
            return false;
        return true;
    });
    const nextCursor = response['@odata.nextLink'] ?? null;
    return {
        messages,
        nextCursor,
        hasMore: Boolean(nextCursor),
    };
}
/**
 * Fetch a single message detail by its ID.
 */
async function fetchSingleMessage(accessToken, mailboxId, messageId) {
    const basePath = mailboxId === 'me' ? '/me' : `/users/${encodeURIComponent(mailboxId)}`;
    const endpoint = `${basePath}/messages/${encodeURIComponent(messageId)}?$select=${exports.MESSAGE_SELECT_FIELDS}`;
    const response = await (0, graph_client_1.graphGet)(endpoint, accessToken);
    return normalizeGraphMessage(response, mailboxId);
}
