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
    let fromName = msg.sender || null;
    let fromAddress = msg.fromAddress || msg.from || '';
    const fromRaw = msg.from || msg.sender || '';
    const match = /(.*)<([^>]+)>/.exec(fromRaw);
    if (match) {
        fromName = match[1].trim() || fromName;
        fromAddress = match[2].trim();
    }
    if (!fromAddress && msg.fromAddress) {
        fromAddress = msg.fromAddress;
    }
    if (fromAddress && fromAddress.includes('<')) {
        const addrMatch = /<([^>]+)>/.exec(fromAddress);
        if (addrMatch) fromAddress = addrMatch[1].trim();
    }

    // Parse recipient info (especially for sent emails)
    let toAddress = msg.toAddress || msg.toAddr || null;
    if (toAddress && typeof toAddress === 'string') {
        toAddress = toAddress
            .replace(/&quot;/g, '"')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&');
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
        toAddress,
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
 * Resolve Zoho folder ID by trying the /folders API first,
 * and falling back to deterministic Zoho mailbox offsets if folder READ scope is not available.
 */
async function resolveZohoFolderId(accessToken, mailboxId, cleanFolder, baseUrl) {
    if (cleanFolder === 'all') return null;
    // 1. Try to query /accounts/${mailboxId}/folders if scope permits
    try {
        const foldersRes = await (0, zoho_client_1.zohoGet)(`/accounts/${mailboxId}/folders`, accessToken, baseUrl);
        const folders = foldersRes.data ?? [];
        if (Array.isArray(folders) && folders.length > 0) {
            let targetZohoFolder = null;
            if (cleanFolder === 'sent') {
                targetZohoFolder = folders.find((f) => (f.folderName || f.folderPath || '').toLowerCase().includes('sent'));
            } else if (cleanFolder === 'spam') {
                targetZohoFolder = folders.find((f) => {
                    const n = (f.folderName || f.folderPath || '').toLowerCase();
                    return n.includes('spam') || n.includes('junk');
                });
            } else if (cleanFolder === 'inbox') {
                targetZohoFolder = folders.find((f) => (f.folderName || f.folderPath || '').toLowerCase().includes('inbox'));
            } else if (cleanFolder === 'drafts' || cleanFolder === 'draft') {
                targetZohoFolder = folders.find((f) => (f.folderName || f.folderPath || '').toLowerCase().includes('draft'));
            } else if (cleanFolder === 'outbox') {
                targetZohoFolder = folders.find((f) => (f.folderName || f.folderPath || '').toLowerCase().includes('outbox'));
            }
            if (targetZohoFolder && targetZohoFolder.folderId) {
                return String(targetZohoFolder.folderId);
            }
        }
    } catch (fErr) {
        // Scope might not include ZohoMail.folders.READ
    }

    // 2. Discover folderId dynamically using Zoho search API `in:<folder>`
    try {
        const searchKey = cleanFolder === 'sent' ? 'in:sent' :
                          cleanFolder === 'spam' ? 'in:spam' :
                          cleanFolder === 'inbox' ? 'in:inbox' :
                          (cleanFolder === 'drafts' || cleanFolder === 'draft') ? 'in:drafts' :
                          cleanFolder === 'outbox' ? 'in:outbox' : null;
        if (searchKey) {
            const searchRes = await (0, zoho_client_1.zohoGet)(`/accounts/${mailboxId}/messages/search?limit=1&searchKey=${encodeURIComponent(searchKey)}`, accessToken, baseUrl);
            if (searchRes.data?.length > 0 && searchRes.data[0].folderId) {
                return String(searchRes.data[0].folderId);
            }
        }
    } catch {
        // search query failed or unsupported
    }

    // 3. Fall back to deterministic Zoho system folder IDs relative to mailboxId:
    // +6: Inbox, +8: Drafts, +9: Templates, +10: Sent, +11: Spam, +12: Trash, +13: Outbox
    try {
        const baseId = BigInt(mailboxId);
        if (cleanFolder === 'sent') return (baseId + 10n).toString();
        if (cleanFolder === 'spam') return (baseId + 11n).toString();
        if (cleanFolder === 'inbox') return (baseId + 6n).toString();
        if (cleanFolder === 'drafts' || cleanFolder === 'draft') return (baseId + 8n).toString();
        if (cleanFolder === 'templates') return (baseId + 9n).toString();
        if (cleanFolder === 'trash') return (baseId + 12n).toString();
        if (cleanFolder === 'outbox') return (baseId + 13n).toString();
    } catch {
        // non-numeric mailboxId fallback
    }
    return null;
}

/**
 * Fetch a page of Zoho messages.
 * Uses pagination parameters start (1-indexed) and limit.
 */
async function fetchZohoMessages(accessToken, options, baseUrl) {
    const { mailboxId, limit = 50, cursor, startDate, endDate, folder } = options;
    const cleanFolder = folder ? String(folder).toLowerCase() : 'inbox';
    // Cursor for Zoho is formatted as the next sequence start index (e.g. "51")
    const startIndex = cursor ? parseInt(cursor, 10) : 1;
    
    const resolvedFolderId = options.remoteFolderId || await resolveZohoFolderId(accessToken, mailboxId, cleanFolder, baseUrl);
    let folderQuery = '';
    if (resolvedFolderId) {
        folderQuery = `&folderId=${resolvedFolderId}`;
    } else if (cleanFolder === 'sent' || cleanFolder === 'spam' || cleanFolder === 'drafts' || cleanFolder === 'outbox') {
        console.warn(`[mail:zoho:fetcher] Cannot resolve folderId for ${cleanFolder}, aborting fetch to avoid inbox contamination`);
        return { messages: [], nextCursor: null, hasMore: false };
    }

    const url = `/accounts/${mailboxId}/messages/view?start=${startIndex}&limit=${limit}${folderQuery}`;
    const response = await (0, zoho_client_1.zohoGet)(url, accessToken, baseUrl);
    const rawList = response.data ?? [];
    const startMs = startDate ? new Date(startDate).getTime() : undefined;
    const endMs = endDate ? new Date(endDate).getTime() : undefined;
    let reachedOlderThanStart = false;
    const filteredMessages = [];
    for (const item of rawList) {
        const norm = normalizeZohoMessage(item, mailboxId);
        norm.folder = cleanFolder;
        if (cleanFolder === 'spam') norm.isSpam = true;
        const time = new Date(norm.receivedAt).getTime();
        if (endMs !== undefined && !isNaN(endMs) && time > endMs) {
            // Message is newer than window end (can happen if window is in the past)
            continue;
        }
        if (cleanFolder !== 'spam' && cleanFolder !== 'drafts' && cleanFolder !== 'outbox' && startMs !== undefined && !isNaN(startMs) && time < startMs) {
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
