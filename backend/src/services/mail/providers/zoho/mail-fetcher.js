"use strict";
// src/lib/mail/providers/zoho/mail-fetcher.ts
// -----------------------------------------------------------------------------
// Zoho Mail message fetcher, search, and normalizer.
// -----------------------------------------------------------------------------
Object.defineProperty(exports, "__esModule", { value: true });
exports.getZohoAccounts = getZohoAccounts;
exports.fetchZohoContent = fetchZohoContent;
exports.normalizeZohoMessage = normalizeZohoMessage;
exports.fetchZohoMessages = fetchZohoMessages;
const zoho_client_1 = require("./zoho-client");
const content_extractor_1 = require("../../content-extractor");
/**
 * Retrieve user's mail accounts from Zoho.
 */
async function getZohoAccounts(accessToken, baseUrl) {
    const res = await (0, zoho_client_1.zohoGet)('/accounts', accessToken, baseUrl);
    return res.data ?? [];
}
/**
 * Retrieve email body content for a specific message.
 */
async function fetchZohoContent(accessToken, accountId, folderId, messageId, baseUrl) {
    const fId = folderId || '0';
    const url = `/accounts/${accountId}/folders/${fId}/messages/${messageId}/content`;
    try {
        const res = await (0, zoho_client_1.zohoGet)(url, accessToken, baseUrl);
        const rawContent = res.data?.content || res.data?.mailBody || '';
        const isHtml = /<[a-z][\s\S]*>/i.test(rawContent);
        return {
            bodyHtml: isHtml ? rawContent : null,
            bodyText: isHtml ? null : rawContent,
        };
    }
    catch (err) {
        console.warn(`[mail:zoho:fetcher] Could not fetch content for msg ${messageId}:`, err);
        return { bodyHtml: null, bodyText: null };
    }
}
/**
 * Normalize a Zoho message object to NormalizedMessage.
 */
function normalizeZohoMessage(msg, mailboxId, content) {
    // Parse receivedTime which may be epoch ms number or timestamp string
    let receivedIso = new Date().toISOString();
    const rawTime = msg.receivedTime ?? msg.sentDateInGMT;
    if (typeof rawTime === 'number') {
        receivedIso = new Date(rawTime).toISOString();
    }
    else if (typeof rawTime === 'string') {
        const trimmed = rawTime.trim();
        const num = Number(trimmed);
        if (!isNaN(num) && num > 0) {
            receivedIso = new Date(num).toISOString();
        }
        else {
            const parsed = new Date(trimmed);
            if (!isNaN(parsed.getTime())) {
                receivedIso = parsed.toISOString();
            }
        }
    }
    // Parse sender info
    const fromRaw = msg.from || msg.sender || '';
    let fromName = null;
    let fromAddress = fromRaw;
    const match = /(.*)<([^>]+)>/.exec(fromRaw);
    if (match) {
        fromName = match[1].trim() || null;
        fromAddress = match[2].trim();
    }
    const rawHasAtt = msg.hasAttachment !== undefined ? msg.hasAttachment : msg.hasAttachments;
    const hasAtt = rawHasAtt === true ||
        rawHasAtt === 'true' ||
        rawHasAtt === 1 ||
        rawHasAtt === '1';
    const rawHtml = content?.bodyHtml ?? (msg.content && /<[a-z][\s\S]*>/i.test(msg.content) ? msg.content : null);
    const rawText = content?.bodyText ?? (msg.content && !/<[a-z][\s\S]*>/i.test(msg.content) ? msg.content : null);
    const extracted = (0, content_extractor_1.extractEmailContent)({
        html: rawHtml,
        text: rawText,
    });
    return {
        id: String(msg.messageId),
        provider: 'ZOHO',
        providerMessageId: String(msg.messageId),
        mailboxId,
        subject: msg.subject ?? null,
        fromName,
        fromAddress,
        receivedAt: receivedIso,
        bodyPreview: msg.summary ?? null,
        bodyHtml: extracted.bodyHtml,
        bodyText: extracted.bodyText,
        links: extracted.links,
        hasAttachments: hasAtt,
        rawHeaders: msg.folderId ? { folderId: String(msg.folderId) } : undefined,
    };
}
/**
 * Fetch a page of Zoho messages.
 * Uses pagination parameters start (1-indexed) and limit.
 */
async function fetchZohoMessages(accessToken, options, baseUrl) {
    const { mailboxId, limit = 50, cursor, startDate, endDate } = options;
    // Cursor for Zoho is formatted as the next sequence start index (e.g. "51")
    const startIndex = cursor ? parseInt(cursor, 10) : 1;
    const url = `/accounts/${mailboxId}/messages/view?start=${startIndex}&limit=${limit}`;
    const response = await (0, zoho_client_1.zohoGet)(url, accessToken, baseUrl);
    const rawList = response.data ?? [];
    const startMs = startDate ? new Date(startDate).getTime() : undefined;
    const endMs = endDate ? new Date(endDate).getTime() : undefined;
    let reachedOlderThanStart = false;
    const filteredMessages = [];
    for (const item of rawList) {
        const norm = normalizeZohoMessage(item, mailboxId);
        const time = new Date(norm.receivedAt).getTime();
        if (endMs !== undefined && !isNaN(endMs) && time > endMs) {
            // Message is newer than window end (can happen if window is in the past)
            continue;
        }
        if (startMs !== undefined && !isNaN(startMs) && time < startMs) {
            // Message is older than window start.
            // Because Zoho messages/view is strictly reverse-chronological (newest first),
            // all remaining items in this page and subsequent pages will be strictly older.
            // Stop processing immediately and terminate pagination.
            reachedOlderThanStart = true;
            break;
        }
        filteredMessages.push(norm);
    }
    // Fetch full top-to-bottom content for each message in the filtered window
    const BATCH_SIZE = 5;
    for (let i = 0; i < filteredMessages.length; i += BATCH_SIZE) {
        const batch = filteredMessages.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (msg) => {
            try {
                const folderId = msg.rawHeaders?.folderId || '0';
                const content = await fetchZohoContent(accessToken, mailboxId, folderId, msg.providerMessageId, baseUrl);
                const extracted = (0, content_extractor_1.extractEmailContent)({
                    html: content.bodyHtml,
                    text: content.bodyText,
                });
                msg.bodyHtml = extracted.bodyHtml;
                msg.bodyText = extracted.bodyText;
                msg.links = extracted.links;
            }
            catch (err) {
                console.warn(`[zoho:fetcher] Could not fetch complete content for ${msg.providerMessageId}:`, err);
            }
        }));
    }
    const hasMore = rawList.length >= limit && !reachedOlderThanStart;
    const nextCursor = hasMore ? String(startIndex + rawList.length) : null;
    return {
        messages: filteredMessages,
        nextCursor,
        hasMore,
    };
}
