"use strict";
// src/features/mail-router/infra/db/emailRepo.ts
// All SQL relating to imported_emails lives here.
// Supports multi-provider (Microsoft + Zoho).
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertEmail = upsertEmail;
exports.getEmailById = getEmailById;
exports.getEmailByGraphId = getEmailByGraphId;
exports.getEmailByProviderMessageId = getEmailByProviderMessageId;
exports.listEmailsInWindow = listEmailsInWindow;
exports.deleteEmailsOlderThan = deleteEmailsOlderThan;
const db_1 = require("../../db");
function mapRow(row) {
    const provider = row.provider || 'MICROSOFT';
    const providerMsgId = row.provider_message_id || row.graph_message_id;
    return {
        id: row.id,
        provider,
        providerMessageId: providerMsgId,
        mailboxId: row.mailbox_id || null,
        graphMessageId: row.graph_message_id || providerMsgId,
        syncJobId: row.sync_job_id,
        subject: row.subject,
        fromName: row.from_name,
        fromAddress: row.from_address,
        receivedAt: row.received_at.toISOString(),
        bodyPreview: row.body_preview,
        bodyHtml: row.body_html,
        bodyText: row.body_text,
        links: Array.isArray(row.links) ? row.links : [],
        internetMessageId: row.internet_message_id,
        hasAttachments: Boolean(row.has_attachments),
        createdAt: row.created_at.toISOString(),
    };
}
/**
 * Upsert a Normalized or Graph message into imported_emails.
 * ON CONFLICT (provider, provider_message_id) DO UPDATE — idempotent.
 */
async function upsertEmail(message, syncJobId, mailboxId) {
    let provider = 'MICROSOFT';
    let providerMessageId = message.id;
    let subject = null;
    let fromName = null;
    let fromAddress = '';
    let receivedAt = '';
    let bodyPreview = null;
    let bodyHtml = null;
    let bodyText = null;
    let links = [];
    let internetMessageId = null;
    let hasAttachments = false;
    let targetMailboxId = mailboxId || null;
    if ('provider' in message) {
        // NormalizedMessage
        const norm = message;
        provider = norm.provider;
        providerMessageId = norm.providerMessageId;
        subject = norm.subject ?? null;
        fromName = norm.fromName ?? null;
        fromAddress = norm.fromAddress ?? '';
        receivedAt = norm.receivedAt;
        bodyPreview = norm.bodyPreview ?? null;
        bodyHtml = norm.bodyHtml ?? null;
        bodyText = norm.bodyText ?? null;
        links = norm.links ?? [];
        internetMessageId = norm.internetMessageId ?? null;
        hasAttachments = norm.hasAttachments;
        targetMailboxId = targetMailboxId || norm.mailboxId || null;
    }
    else {
        // Legacy GraphMessage
        const gm = message;
        provider = 'MICROSOFT';
        providerMessageId = gm.id;
        subject = gm.subject ?? null;
        fromName = gm.from?.emailAddress?.name ?? null;
        fromAddress = gm.from?.emailAddress?.address ?? '';
        receivedAt = gm.receivedDateTime;
        bodyPreview = gm.bodyPreview ?? null;
        bodyHtml = gm.body?.contentType === 'html' ? gm.body.content ?? null : null;
        bodyText = gm.body?.contentType === 'text' ? gm.body.content ?? null : null;
        internetMessageId = gm.internetMessageId ?? null;
        hasAttachments = Boolean(gm.hasAttachments);
    }
    const isUuid = typeof targetMailboxId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetMailboxId);
    const safeMailboxId = isUuid ? targetMailboxId : null;
    const { rows } = await (0, db_1.query)(`INSERT INTO imported_emails
       (provider, provider_message_id, mailbox_id, graph_message_id, sync_job_id,
        subject, from_name, from_address, received_at, body_preview, body_html, body_text,
        links, internet_message_id, has_attachments)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     ON CONFLICT (provider, provider_message_id) DO UPDATE
       SET sync_job_id       = EXCLUDED.sync_job_id,
           mailbox_id        = COALESCE(EXCLUDED.mailbox_id, imported_emails.mailbox_id),
           subject           = COALESCE(EXCLUDED.subject, imported_emails.subject),
           received_at       = EXCLUDED.received_at,
           body_html         = COALESCE(EXCLUDED.body_html, imported_emails.body_html),
           body_text         = COALESCE(EXCLUDED.body_text, imported_emails.body_text),
           links             = CASE WHEN jsonb_array_length(EXCLUDED.links) > 0 THEN EXCLUDED.links ELSE imported_emails.links END,
           has_attachments   = EXCLUDED.has_attachments
     RETURNING *`, [
        provider,
        providerMessageId,
        safeMailboxId,
        providerMessageId, // populate graph_message_id for backwards compat
        syncJobId,
        subject,
        fromName,
        fromAddress,
        receivedAt,
        bodyPreview,
        bodyHtml,
        bodyText,
        JSON.stringify(links),
        internetMessageId,
        hasAttachments,
    ]);
    return mapRow(rows[0]);
}
/** Get a single email by its internal UUID. */
async function getEmailById(id) {
    const { rows } = await (0, db_1.query)('SELECT * FROM imported_emails WHERE id = $1', [id]);
    return rows[0] ? mapRow(rows[0]) : null;
}
/** Get a single email by its Graph or provider message ID. */
async function getEmailByGraphId(graphMessageId) {
    const { rows } = await (0, db_1.query)('SELECT * FROM imported_emails WHERE graph_message_id = $1 OR provider_message_id = $1', [graphMessageId]);
    return rows[0] ? mapRow(rows[0]) : null;
}
/** Get an email by provider and provider message ID. */
async function getEmailByProviderMessageId(provider, providerMessageId) {
    const { rows } = await (0, db_1.query)('SELECT * FROM imported_emails WHERE provider = $1 AND provider_message_id = $2', [provider, providerMessageId]);
    return rows[0] ? mapRow(rows[0]) : null;
}
/** List emails received within a UTC window (newest first), with optional provider and user filter. */
async function listEmailsInWindow(startUtc, endUtc, limit = 100, offset = 0, provider, userId) {
    let sql = `SELECT * FROM imported_emails
              WHERE received_at >= $1 AND received_at <= $2`;
    const params = [startUtc, endUtc];
    if (userId) {
        params.push(userId);
        sql += ` AND (
      mailbox_id IN (SELECT id FROM mail_accounts WHERE user_id = $${params.length})
      OR sync_job_id IN (SELECT id FROM sync_jobs WHERE triggered_by = $${params.length})
    )`;
    }
    if (provider) {
        params.push(provider);
        sql += ` AND provider = $${params.length}`;
    }
    params.push(limit, offset);
    sql += ` ORDER BY received_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
    const { rows } = await (0, db_1.query)(sql, params);
    return rows.map(mapRow);
}
/** Delete emails older than the given UTC timestamp (retention cleanup). */
async function deleteEmailsOlderThan(cutoffUtc) {
    const { rowCount } = await (0, db_1.query)(`DELETE FROM imported_emails WHERE received_at < $1`, [cutoffUtc]);
    return rowCount ?? 0;
}
